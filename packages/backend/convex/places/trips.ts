import { v } from "convex/values";
import { err, errAsync, ok, okAsync, ResultAsync, type Result } from "neverthrow";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { TRIP_LOOK_LIMIT_MS, type TravelMode } from "../../shared/features";
import { ownerMutation, ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { attemptsFor, capabilityChain } from "../ai/capabilities";
import { askChoice } from "../ai/transport";
import { featureReady, featureState } from "../platform/features";
import { sha256Hex } from "../platform/workers";
import { USER_AGENT, type ModelId } from "../../shared/ai";
import { canonicalJson } from "../planner/smartEstimateModel";
import {
  nearestPlaces,
  OVERPASS_URL,
  overpassQuery,
  parseTripDecision,
  placePhrases,
  roundedPosition,
  routingUrl,
  TRIP_THRESHOLD,
  tripAsk,
  withTravel,
  type TripDecision,
} from "./model";
import { homeOf } from "./saved";
import { vTripOutcome, type Place, type PlacesError, type Position, type TripOutcome } from "./tables";

export const DEBOUNCE_MS = 2_000;

export type TripError = { readonly kind: "no_trip" } | { readonly kind: "unknown_place" };

const tripRow = (ctx: QueryCtx, taskId: Id<"tasks">) =>
  ctx.db
    .query("taskTrips")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .unique();

const wantsTrip = (task: Doc<"tasks">) => task.status.kind === "open" && task.trashedAt === undefined;

const samePosition = (a: Position, b: Position) => a.lat === b.lat && a.lon === b.lon;

const isStale = async (ctx: QueryCtx, outcome: TripOutcome) => {
  if (outcome.kind === "failed") return true;
  if (outcome.kind !== "found" && outcome.kind !== "unfound") return false;
  const [home, places] = await Promise.all([homeOf(ctx), featureState(ctx, "places")]);
  return !home || !samePosition(outcome.from, roundedPosition(home.position)) || outcome.mode !== places.settings.travelMode;
};

export const requestTrip = async (ctx: MutationCtx, taskId: Id<"tasks">, { onlyFirst = false } = {}) => {
  if (!(await featureReady(ctx, "places"))) return false;
  const task = await ctx.db.get("tasks", taskId);
  if (!task || !wantsTrip(task)) return false;
  const row = await tripRow(ctx, taskId);
  const stuck = row?.outcome.kind === "waiting" && Date.now() - row.requestedAt > TRIP_LOOK_LIMIT_MS;
  if (row && onlyFirst && !stuck && !(await isStale(ctx, row.outcome))) return false;
  const requestedAt = Math.max(Date.now(), (row?.requestedAt ?? 0) + 1);
  const retried = row?.outcome.kind === "failed" && row.outcome.query !== undefined ? { outcome: { kind: "waiting" as const, query: row.outcome.query } } : {};
  if (row) await ctx.db.patch("taskTrips", row._id, { requestedAt, ...retried });
  else await ctx.db.insert("taskTrips", { taskId, requestedAt, outcome: { kind: "waiting" }, choice: { kind: "nearest" } });
  await ctx.scheduler.runAfter(DEBOUNCE_MS, internal.places.trips.locate, { taskId, requestedAt });
  return true;
};

export const request = ownerMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => ({ requested: await requestTrip(ctx, taskId, { onlyFirst: true }) }),
});

const chosenOf = (row: Doc<"taskTrips">) => {
  if (row.outcome.kind !== "found" || row.choice.kind === "dismissed") return null;
  const { choice } = row;
  const places = row.outcome.places;
  const chosen = (choice.kind === "picked" ? places.find((place) => place.key === choice.key) : undefined) ?? places[0];
  return chosen ? { chosen, places, outcome: row.outcome } : null;
};

export const chosenTrip = async (ctx: QueryCtx, taskId: Id<"tasks">) => {
  const row = await tripRow(ctx, taskId);
  const chosen = row ? chosenOf(row) : null;
  return chosen?.chosen.travel ? { name: chosen.chosen.name, seconds: chosen.chosen.travel.seconds, mode: chosen.outcome.mode } : null;
};

export const forTask = ownerQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    if (!(await featureReady(ctx, "places"))) return null;
    const row = await tripRow(ctx, taskId);
    if (!row) return null;
    if (row.outcome.kind === "unfound") return { kind: "unfound" as const, query: row.outcome.query, mode: row.outcome.mode };
    if (row.outcome.kind === "waiting" && row.outcome.query !== undefined) return { kind: "looking" as const, query: row.outcome.query, since: row.requestedAt };
    if (row.outcome.kind === "failed" && row.outcome.query !== undefined) return { kind: "failed" as const, query: row.outcome.query };
    const trip = chosenOf(row);
    if (!trip) return null;
    const { query, mode, from } = trip.outcome;
    return { kind: "trip" as const, query, mode, from, chosen: trip.chosen, places: trip.places };
  },
});

const foundRow = async (ctx: QueryCtx, taskId: Id<"tasks">) => {
  const row = await tripRow(ctx, taskId);
  return row && row.outcome.kind === "found" ? ok(row) : err<Doc<"taskTrips">, TripError>({ kind: "no_trip" });
};

export const choose = changeMutation({
  action: "trip.choose",
  args: { taskId: v.id("tasks"), key: v.string() },
  handler: async (ctx, { taskId, key }, record) => {
    const row = await foundRow(ctx, taskId);
    if (row.isErr()) return err(row.error);
    const places = row.value.outcome.kind === "found" ? row.value.outcome.places : [];
    if (!places.some((place) => place.key === key)) return err<{ changed: boolean }, TripError>({ kind: "unknown_place" });
    return ok({ changed: await record.patch("taskTrips", row.value._id, { choice: { kind: "picked", key } }) });
  },
});

export const dismiss = changeMutation({
  action: "trip.dismiss",
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }, record) => {
    const row = await foundRow(ctx, taskId);
    if (row.isErr()) return err(row.error);
    return ok({ changed: await record.patch("taskTrips", row.value._id, { choice: { kind: "dismissed" } }) });
  },
});

export type TripPlan =
  | { kind: "skip" }
  | { kind: "gone" }
  | { kind: "ask"; title: string; from: Position; mode: TravelMode; chain: ModelId[]; cachedHash: string | null };

export const planFor = internalQuery({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  handler: async (ctx, { taskId, requestedAt }) => {
    const skip = { kind: "skip" } satisfies TripPlan;
    const row = await tripRow(ctx, taskId);
    if (!row || row.requestedAt !== requestedAt) return skip;
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return { kind: "gone" } satisfies TripPlan;
    const [places, home] = await Promise.all([featureState(ctx, "places"), homeOf(ctx)]);
    const chain = await capabilityChain(ctx, "tripDetection");
    if (!wantsTrip(task) || places.status.kind !== "ready" || !home || chain.length === 0) return skip;
    const cachedHash = row.outcome.kind === "waiting" || row.outcome.kind === "failed" ? null : row.outcome.inputsHash;
    return {
      kind: "ask",
      title: task.title,
      from: roundedPosition(home.position),
      mode: places.settings.travelMode,
      chain,
      cachedHash,
    } satisfies TripPlan;
  },
});

export const record = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), outcome: vTripOutcome },
  returns: v.null(),
  handler: async (ctx, { taskId, requestedAt, outcome }) => {
    const row = await tripRow(ctx, taskId);
    if (row?.requestedAt !== requestedAt) return null;
    const sameQuery = row.outcome.kind === "found" && outcome.kind === "found" && row.outcome.query === outcome.query;
    await ctx.db.patch("taskTrips", row._id, sameQuery ? { outcome } : { outcome, choice: { kind: "nearest" } });
    return null;
  },
});

export const searching = internalMutation({
  args: { taskId: v.id("tasks"), requestedAt: v.number(), query: v.string() },
  returns: v.null(),
  handler: async (ctx, { taskId, requestedAt, query }) => {
    const row = await tripRow(ctx, taskId);
    if (row?.requestedAt !== requestedAt) return null;
    if (row.outcome.kind === "found" && row.outcome.query === query) return null;
    await ctx.db.patch("taskTrips", row._id, { outcome: { kind: "waiting", query } });
    return null;
  },
});

export const forget = internalMutation({
  args: { taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, { taskId }) => {
    const row = await tripRow(ctx, taskId);
    if (row) await ctx.db.delete("taskTrips", row._id);
    return null;
  },
});

const failureOf = (response: Response) => {
  if (response.status === 401 || response.status === 403) return { kind: "unauthorised" } satisfies PlacesError;
  if (response.status === 429) return { kind: "rate_limited" } satisfies PlacesError;
  return { kind: "unavailable", status: response.status } satisfies PlacesError;
};

const UNREACHABLE: PlacesError = { kind: "unavailable" };
const UNREADABLE: PlacesError = { kind: "invalid_response" };

const jsonFrom = (pending: Promise<Response>) =>
  ResultAsync.fromPromise(pending, () => UNREACHABLE).andThen((response) =>
    response.ok
      ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => UNREADABLE)
      : errAsync<unknown, PlacesError>(failureOf(response)),
  );

const searchNear = (query: string, from: Position) =>
  jsonFrom(
    fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: overpassQuery(query, from) }).toString(),
    }),
  ).andThen((body) => nearestPlaces(body, from));

const timed = (mode: TravelMode, from: Position, places: Place[]) =>
  jsonFrom(fetch(routingUrl(mode, from, places), { headers: { "user-agent": USER_AGENT } }))
    .andThen((body) => withTravel(body, places))
    .orElse(() => okAsync<Place[], PlacesError>(places));

type Found = Extract<TripOutcome, { kind: "none" | "unfound" | "found" }> extends infer O ? (O extends unknown ? Omit<O, "inputsHash" | "at"> : never) : never;

const placeWanted = (decision: TripDecision) => (decision.trip < TRIP_THRESHOLD || !decision.place ? null : decision.place);

const tripFor = (query: string | null, from: Position, mode: TravelMode) => {
  if (!query) return okAsync<Found, PlacesError>({ kind: "none" });
  return searchNear(query, from).andThen((nearest) =>
    nearest.length === 0
      ? okAsync<Found, PlacesError>({ kind: "unfound", query, mode, from })
      : timed(mode, from, nearest).map((places) => {
          const found: Found = { kind: "found", query, mode, from, places };
          return found;
        }),
  );
};

export const locate = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plan: TripPlan = await ctx.runQuery(internal.places.trips.planFor, args);
    if (plan.kind === "gone") await ctx.runMutation(internal.places.trips.forget, { taskId: args.taskId });
    if (plan.kind !== "ask") return null;
    const { title, from, mode } = plan;
    const phrases = placePhrases(title);
    const inputsHash = await sha256Hex(canonicalJson({ model: plan.chain[0], title, phrases, from, mode }));
    if (plan.cachedHash === inputsHash) return null;
    const decided = await askChoice(await attemptsFor(ctx, plan.chain), tripAsk(title, phrases), parseTripDecision);
    const query = decided.isOk() ? placeWanted(decided.value.value) : null;
    if (query) await ctx.runMutation(internal.places.trips.searching, { ...args, query });
    const result: Result<Found & { answeredBy?: string }, PlacesError> = decided.isErr()
      ? err(decided.error)
      : await tripFor(query, from, mode).map((found) => ({ ...found, answeredBy: decided.value.answeredBy }));
    const at = Date.now();
    const outcome: TripOutcome = result.match(
      (found) => ({ ...found, inputsHash, at }),
      (error) => ({ kind: "failed" as const, error, inputsHash, at, ...(query ? { query } : {}) }),
    );
    await ctx.runMutation(internal.places.trips.record, { ...args, outcome });
    return null;
  },
});

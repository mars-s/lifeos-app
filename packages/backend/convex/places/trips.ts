import { v } from "convex/values";
import { Clock, Effect, Result } from "effect";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { TRIP_LOOK_LIMIT_MS, type TravelMode } from "../../shared/features";
import { effectFromNeverthrow } from "../../shared/effect/bridge";
import { wireError } from "../../shared/effect/wire";
import { acting, changeMutation, internalAction, ownerMutation, ownerQuery, reading, recording, writing } from "../platform/effect";
import { attemptsFor, capabilityChain } from "../ai/capabilities";
import { askChoice } from "../ai/transport";
import { featureReady, featureState } from "../platform/features";
import { sha256Hex } from "../platform/workers";
import type { ModelId } from "../../shared/ai";
import { canonicalJson } from "../planner/smartEstimateModel";
import { NoTrip, UnknownPlace } from "./errors";
import { parseTripDecision, placePhrases, roundedPosition, TRIP_THRESHOLD, tripAsk, type TripDecision } from "./model";
import { Places } from "./provider";
import { homeOf } from "./saved";
import { vTripOutcome, type Position, type TripOutcome } from "./tables";

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
  handler: Effect.fn("trips.request")(function* ({ taskId }) {
    return { requested: yield* writing((ctx) => requestTrip(ctx, taskId, { onlyFirst: true })) };
  }),
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
  handler: Effect.fn("trips.forTask")(function* ({ taskId }) {
    if (!(yield* reading((ctx) => featureReady(ctx, "places")))) return null;
    const row = yield* reading((ctx) => tripRow(ctx, taskId));
    if (!row) return null;
    if (row.outcome.kind === "unfound") return { kind: "unfound" as const, query: row.outcome.query, mode: row.outcome.mode };
    if (row.outcome.kind === "waiting" && row.outcome.query !== undefined) return { kind: "looking" as const, query: row.outcome.query, since: row.requestedAt };
    if (row.outcome.kind === "failed" && row.outcome.query !== undefined) return { kind: "failed" as const, query: row.outcome.query };
    const trip = chosenOf(row);
    if (!trip) return null;
    const { query, mode, from } = trip.outcome;
    return { kind: "trip" as const, query, mode, from, chosen: trip.chosen, places: trip.places };
  }),
});

const foundRow = Effect.fn("trips.foundRow")(function* (taskId: Id<"tasks">) {
  const row = yield* reading((ctx) => tripRow(ctx, taskId));
  if (!row || row.outcome.kind !== "found") return yield* new NoTrip();
  return { row, places: row.outcome.places };
});

export const choose = changeMutation({
  action: "trip.choose",
  args: { taskId: v.id("tasks"), key: v.string() },
  handler: Effect.fn("trips.choose")(function* ({ taskId, key }) {
    const { row, places } = yield* foundRow(taskId);
    if (!places.some((place) => place.key === key)) return yield* new UnknownPlace();
    return { changed: yield* recording((record) => record.patch("taskTrips", row._id, { choice: { kind: "picked", key } })) };
  }),
});

export const dismiss = changeMutation({
  action: "trip.dismiss",
  args: { taskId: v.id("tasks") },
  handler: Effect.fn("trips.dismiss")(function* ({ taskId }) {
    const { row } = yield* foundRow(taskId);
    return { changed: yield* recording((record) => record.patch("taskTrips", row._id, { choice: { kind: "dismissed" } })) };
  }),
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

type Found = Extract<TripOutcome, { kind: "none" | "unfound" | "found" }> extends infer O ? (O extends unknown ? Omit<O, "inputsHash" | "at"> : never) : never;

const placeWanted = (decision: TripDecision) => (decision.trip < TRIP_THRESHOLD || !decision.place ? null : decision.place);

const tripFor = Effect.fn("trips.tripFor")(function* (query: string | null, from: Position, mode: TravelMode) {
  if (!query) return { kind: "none" } satisfies Found;
  const places = yield* Places;
  const nearest = yield* places.nearest(query, from);
  if (nearest.length === 0) return { kind: "unfound", query, mode, from } satisfies Found;
  const timed = yield* places.routed(mode, from, nearest).pipe(Effect.catch(() => Effect.succeed(nearest)));
  return { kind: "found", query, mode, from, places: [...timed] } satisfies Found;
});

const planOf = (args: { taskId: Id<"tasks">; requestedAt: number }) =>
  acting((ctx) => {
    const plan: Promise<TripPlan> = ctx.runQuery(internal.places.trips.planFor, args);
    return plan;
  });

const forgetTrip = (taskId: Id<"tasks">) =>
  acting((ctx) => {
    const forgotten: Promise<null> = ctx.runMutation(internal.places.trips.forget, { taskId });
    return forgotten;
  });

const markSearching = (args: { taskId: Id<"tasks">; requestedAt: number; query: string }) =>
  acting((ctx) => {
    const marked: Promise<null> = ctx.runMutation(internal.places.trips.searching, args);
    return marked;
  });

const recordOutcome = (args: { taskId: Id<"tasks">; requestedAt: number; outcome: TripOutcome }) =>
  acting((ctx) => {
    const recorded: Promise<null> = ctx.runMutation(internal.places.trips.record, args);
    return recorded;
  });

export const locate = internalAction({
  args: { taskId: v.id("tasks"), requestedAt: v.number() },
  returns: v.null(),
  handler: Effect.fn("trips.locate")(function* (args) {
    const plan = yield* planOf(args);
    if (plan.kind === "gone") yield* forgetTrip(args.taskId);
    if (plan.kind !== "ask") return null;
    const { title, from, mode } = plan;
    const phrases = placePhrases(title);
    const inputsHash = yield* Effect.promise(() => sha256Hex(canonicalJson({ model: plan.chain[0], title, phrases, from, mode })));
    if (plan.cachedHash === inputsHash) return null;
    const attempts = yield* acting((ctx) => attemptsFor(ctx, plan.chain));
    const decided = yield* Effect.result(effectFromNeverthrow(() => askChoice(attempts, tripAsk(title, phrases), parseTripDecision)));
    const query = Result.isSuccess(decided) ? placeWanted(decided.success.value) : null;
    if (query) yield* markSearching({ ...args, query });
    const answeredBy = Result.isSuccess(decided) ? decided.success.answeredBy : undefined;
    const searched = Result.isFailure(decided) ? Result.fail(decided.failure) : yield* Effect.result(tripFor(query, from, mode));
    const at = yield* Clock.currentTimeMillis;
    const outcome: TripOutcome = Result.isSuccess(searched)
      ? { ...searched.success, ...(answeredBy ? { answeredBy } : {}), inputsHash, at }
      : { kind: "failed", error: wireError(searched.failure), inputsHash, at, ...(query ? { query } : {}) };
    yield* recordOutcome({ ...args, outcome });
    return null;
  }, Effect.provide(Places.layer)),
});

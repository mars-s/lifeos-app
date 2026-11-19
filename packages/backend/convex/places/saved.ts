import { v } from "convex/values";
import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { serialise, type SerialisedResult } from "../../shared/result";
import { vPlaceLabel, type PlaceLabel } from "../../shared/features";
import { ownerAction, ownerQuery } from "../platform/access";
import { geocodeUrl, normalisedAddress, parseGeocode, USER_AGENT, type Geocoded } from "./model";
import { vPosition } from "./tables";

export type SavePlaceError =
  | { readonly kind: "empty" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unavailable"; readonly status: number }
  | { readonly kind: "invalid_response" };

export type SavedPlace = { readonly label: PlaceLabel; readonly address: string; readonly found: string; readonly savedAt: number };

const PLACE_LIMIT = 3;

const placeRow = (ctx: QueryCtx, label: PlaceLabel) =>
  ctx.db
    .query("savedPlaces")
    .withIndex("by_label", (q) => q.eq("label", label))
    .unique();

export const homeOf = (ctx: QueryCtx) => placeRow(ctx, "home");

export const list = ownerQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("savedPlaces").withIndex("by_label").take(PLACE_LIMIT)).map(
      ({ label, address, found, savedAt }) => ({ label, address, found, savedAt }) satisfies SavedPlace,
    ),
});

export const known = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("savedPlaces").withIndex("by_label").take(PLACE_LIMIT),
});

const geocode = (address: string) => {
  const unreachable: SavePlaceError = { kind: "unreachable" };
  const unreadable: SavePlaceError = { kind: "invalid_response" };
  return ResultAsync.fromPromise(
    fetch(geocodeUrl(address), { headers: { "user-agent": USER_AGENT, "accept-language": "en-AU" } }),
    () => unreachable,
  )
    .andThen((response) =>
      response.ok
        ? ResultAsync.fromPromise(response.json() as Promise<unknown>, () => unreadable)
        : errAsync<unknown, SavePlaceError>({ kind: "unavailable", status: response.status }),
    )
    .andThen((body) => parseGeocode(body).mapErr(() => unreadable))
    .andThen((geocoded) => (geocoded ? ok(geocoded) : err<Geocoded, SavePlaceError>({ kind: "not_found" })));
};

const saveArgs = { label: vPlaceLabel, address: v.string() };

type Save = ReturnType<typeof ownerAction<typeof saveArgs, SerialisedResult<SavedPlace, SavePlaceError>>>;

export const save: Save = ownerAction({
  args: saveArgs,
  handler: async (ctx, { label, address }) => {
    const trimmed = address.trim().replace(/\s+/g, " ");
    if (trimmed === "") return serialise(err<SavedPlace, SavePlaceError>({ kind: "empty" }));
    const places: Doc<"savedPlaces">[] = await ctx.runQuery(internal.places.saved.known, {});
    const cached = places.find((place) => normalisedAddress(place.address) === normalisedAddress(trimmed));
    const located = cached ? okAsync<Geocoded, SavePlaceError>({ position: cached.position, found: cached.found }) : geocode(trimmed);
    const result = await located.andThen(({ position, found }) => {
      const saved = { label, address: trimmed, found, savedAt: Date.now() } satisfies SavedPlace;
      return ResultAsync.fromSafePromise(ctx.runMutation(internal.places.saved.store, { ...saved, position })).map(() => saved);
    });
    return serialise(result);
  },
});

const removeArgs = { label: vPlaceLabel };

type Remove = ReturnType<typeof ownerAction<typeof removeArgs, null>>;

export const remove: Remove = ownerAction({
  args: removeArgs,
  handler: async (ctx, { label }) => {
    await ctx.runMutation(internal.places.saved.forget, { label });
    return null;
  },
});

export const store = internalMutation({
  args: { label: vPlaceLabel, address: v.string(), position: vPosition, found: v.string(), savedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, row) => {
    const existing = await placeRow(ctx, row.label);
    if (existing) await ctx.db.replace("savedPlaces", existing._id, row);
    else await ctx.db.insert("savedPlaces", row);
    return null;
  },
});

export const forget = internalMutation({
  args: { label: vPlaceLabel },
  returns: v.null(),
  handler: async (ctx, { label }) => {
    const existing = await placeRow(ctx, label);
    if (existing) await ctx.db.delete("savedPlaces", existing._id);
    return null;
  },
});

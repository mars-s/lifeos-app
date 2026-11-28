import { v } from "convex/values";
import { Clock, Effect } from "effect";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "../_generated/server";
import { asWire, type SerialisedResult, type Wire } from "../../shared/result";
import { vPlaceLabel, type PlaceLabel } from "../../shared/features";
import { acting, ownerAction, ownerQuery, reading } from "../platform/effect";
import { AddressEmpty, AddressNotFound, type SavePlaceFailure } from "./errors";
import { normalisedAddress } from "./model";
import { Places } from "./provider";
import { vPosition, type Position } from "./tables";

export type SavePlaceError = Wire<SavePlaceFailure>;

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
  handler: () =>
    reading(async (ctx) =>
      (await ctx.db.query("savedPlaces").withIndex("by_label").take(PLACE_LIMIT)).map(
        ({ label, address, found, savedAt }) => ({ label, address, found, savedAt }) satisfies SavedPlace,
      ),
    ),
});

export const known = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("savedPlaces").withIndex("by_label").take(PLACE_LIMIT),
});

const knownPlaces = () =>
  acting((ctx) => {
    const places: Promise<Doc<"savedPlaces">[]> = ctx.runQuery(internal.places.saved.known, {});
    return places;
  });

const storePlace = (place: SavedPlace & { position: Position }) =>
  acting((ctx) => {
    const stored: Promise<null> = ctx.runMutation(internal.places.saved.store, place);
    return stored;
  });

const forgetPlace = (label: PlaceLabel) =>
  acting((ctx) => {
    const forgotten: Promise<null> = ctx.runMutation(internal.places.saved.forget, { label });
    return forgotten;
  });

const saveArgs = { label: vPlaceLabel, address: v.string() };

type Save = ReturnType<typeof ownerAction<typeof saveArgs, SerialisedResult<SavedPlace, SavePlaceError>>>;

export const save: Save = ownerAction({
  args: saveArgs,
  handler: Effect.fn("saved.save")(
    function* ({ label, address }) {
      const trimmed = address.trim().replace(/\s+/g, " ");
      if (trimmed === "") return yield* new AddressEmpty();
      const places = yield* knownPlaces();
      const cached = places.find((place) => normalisedAddress(place.address) === normalisedAddress(trimmed));
      const located = cached ? { position: cached.position, found: cached.found } : yield* Places.use((provider) => provider.geocode(trimmed));
      if (!located) return yield* new AddressNotFound();
      const savedAt = yield* Clock.currentTimeMillis;
      const saved = { label, address: trimmed, found: located.found, savedAt } satisfies SavedPlace;
      yield* storePlace({ ...saved, position: located.position });
      return saved;
    },
    asWire,
    Effect.provide(Places.layer),
  ),
});

const removeArgs = { label: vPlaceLabel };

type Remove = ReturnType<typeof ownerAction<typeof removeArgs, null>>;

export const remove: Remove = ownerAction({
  args: removeArgs,
  handler: Effect.fn("saved.remove")(function* ({ label }) {
    yield* forgetPlace(label);
    return null;
  }),
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

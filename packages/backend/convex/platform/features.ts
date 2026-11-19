import { v } from "convex/values";
import { ok } from "neverthrow";
import type { WithoutSystemFields } from "convex/server";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  FEATURE_IDS,
  FEATURES,
  isFeatureId,
  vFeatureChoice,
  vFeatureId,
  type FeatureId,
  type FeatureSecret,
  type FeatureSettings,
  type FeatureSetup,
  type FeatureStatus,
  type FeatureUses,
} from "../../shared/features";
import { ownerQuery } from "./access";
import type { Recorder } from "./activity";
import { changeMutation } from "./change";
import { secretAvailable } from "./secrets";

type FeatureRow<F extends FeatureId> = Extract<Doc<"features">, { feature: F }>;
type FeatureFields = WithoutSystemFields<Doc<"features">>;

const featureRow = <F extends FeatureId>(ctx: QueryCtx, feature: F) =>
  ctx.db
    .query("features")
    .withIndex("by_feature", (q) => q.eq("feature", feature))
    .unique() as Promise<FeatureRow<F> | null>;

const SETUP_DONE = {
  home: async (ctx: QueryCtx) =>
    (await ctx.db
      .query("savedPlaces")
      .withIndex("by_label", (q) => q.eq("label", "home"))
      .unique()) !== null,
} satisfies Record<FeatureSetup, (ctx: QueryCtx) => Promise<boolean>>;

const hasAnyKey = async (ctx: QueryCtx, keys: readonly FeatureSecret[]) => {
  for (const secret of keys) if (await secretAvailable(ctx, secret)) return true;
  return keys.length === 0;
};

const statusOf = async (ctx: QueryCtx, feature: FeatureId, enabled: boolean) => {
  if (!enabled) return { kind: "off" } satisfies FeatureStatus;
  const spec: { keys: readonly FeatureSecret[]; requires: readonly string[]; setup: readonly FeatureSetup[] } = FEATURES[feature];
  if (!(await hasAnyKey(ctx, spec.keys))) return { kind: "needs_key" } satisfies FeatureStatus;
  for (const required of spec.requires.filter(isFeatureId)) {
    if (!(await featureReady(ctx, required))) return { kind: "needs_feature", feature: required } satisfies FeatureStatus;
  }
  for (const setup of spec.setup) {
    if (!(await SETUP_DONE[setup](ctx))) return { kind: "needs_setup", setup } satisfies FeatureStatus;
  }
  return { kind: "ready" } satisfies FeatureStatus;
};

export const featureState = async <F extends FeatureId>(ctx: QueryCtx, feature: F) => {
  const row = await featureRow(ctx, feature);
  const enabled = row?.enabled ?? FEATURES[feature].enabledByDefault;
  const settings = (row?.settings ?? FEATURES[feature].defaultSettings) as FeatureSettings[F];
  const status: FeatureStatus = await statusOf(ctx, feature, enabled);
  return { feature, enabled, settings, status };
};

export const featureReady = async (ctx: QueryCtx, feature: FeatureId) => (await featureState(ctx, feature)).status.kind === "ready";

export const featureUses = <F extends FeatureId>(ctx: QueryCtx, _from: F, used: FeatureUses<F> & FeatureId) => featureReady(ctx, used);

export const list = ownerQuery({
  args: {},
  handler: (ctx) => Promise.all(FEATURE_IDS.map((feature) => featureState(ctx, feature))),
});

export const writeFeature = async (ctx: QueryCtx, record: Recorder, feature: FeatureId, fields: Partial<Pick<FeatureFields, "enabled" | "settings">>) => {
  const row = await featureRow(ctx, feature);
  if (row) return record.patch("features", row._id, fields);
  const { enabled, settings } = await featureState(ctx, feature);
  await record.insert("features", { feature, enabled, settings, ...fields } as FeatureFields);
  return true;
};

export const setEnabled = changeMutation({
  action: "features.setEnabled",
  args: { feature: vFeatureId, enabled: v.boolean() },
  handler: async (ctx, { feature, enabled }, record) => ok<{ changed: boolean }, never>({ changed: await writeFeature(ctx, record, feature, { enabled }) }),
});

export const configure = changeMutation({
  action: "features.configure",
  args: { choice: vFeatureChoice },
  handler: async (ctx, { choice }, record) =>
    ok<{ changed: boolean }, never>({ changed: await writeFeature(ctx, record, choice.feature, { settings: choice.settings }) }),
});

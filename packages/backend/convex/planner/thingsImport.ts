import type { WithoutSystemFields } from "convex/server";
import { v, type GenericValidator, type Infer } from "convex/values";
import { Clock, Effect } from "effect";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sameValue, startRecording, type Recorder } from "../platform/activity";
import { asWire, type Wire } from "../../shared/result";
import { Writes, internalMutation, internalQuery, reading, writing } from "../platform/effect";
import { labelNamed } from "./labels";
import { keyAfter, lastTaskOrder } from "./model";
import type { Parent } from "./tables";
import { Retired } from "./thingsErrors";
import {
  vIncomingArea,
  vIncomingChecklistItem,
  vIncomingHeading,
  vIncomingLabel,
  vIncomingProject,
  vIncomingTask,
  type Skipped,
  type ThingsParent,
} from "./thingsRows";

type Linked = "areas" | "labels" | "projects" | "headings" | "tasks" | "checklistItems";
type Link<T extends Linked> = NonNullable<Doc<T>["things"]>;
type Outcome = "inserted" | "updated" | "unchanged";

export type ImportError = Wire<Retired>;
export type StageCounts = Record<Outcome, number>;

export const syncState = (ctx: QueryCtx) => ctx.db.query("thingsSync").first();

const retiredAtOf = async (ctx: QueryCtx) => (await syncState(ctx))?.retiredAt;

const linked = {
  areas: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("areas").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
  labels: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("labels").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
  projects: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("projects").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
  headings: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("headings").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
  tasks: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("tasks").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
  checklistItems: (ctx: QueryCtx, uuid: string) =>
    ctx.db.query("checklistItems").withIndex("by_things_id", (q) => q.eq("things.id", uuid)).unique(),
} satisfies Record<Linked, (ctx: QueryCtx, uuid: string) => Promise<unknown>>;

const isBuried = async (ctx: QueryCtx, uuid: string) =>
  (await ctx.db
    .query("thingsTombstones")
    .withIndex("by_things_id", (q) => q.eq("thingsId", uuid))
    .first()) !== null;

const withoutUndefined = <F extends object>(fields: F) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as F;

const changedSinceBase = (current: Record<string, unknown>, base: Record<string, unknown>, incoming: Record<string, unknown>) =>
  Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(incoming)])]
      .filter((key) => sameValue(current[key], base[key]) && !sameValue(current[key], incoming[key]))
      .map((key) => [key, incoming[key]]),
  );

const mergeInto = async <T extends Linked>(ctx: MutationCtx, record: Recorder, table: T, existing: Doc<T>, link: Link<T>) => {
  const current = existing as Record<string, unknown> & { things?: { base?: Record<string, unknown> } };
  const base = current.things?.base;
  const incoming = (link.base ?? {}) as Record<string, unknown>;
  const fields = base ? changedSinceBase(current, base, incoming) : {};
  const updated = await record.patch(table, existing._id, fields as Partial<WithoutSystemFields<Doc<T>>>);
  if (!sameValue(current.things, link)) await ctx.db.patch(table, existing._id, { things: link } as never);
  return updated ? "updated" : "unchanged";
};

const keepTrashedAt = <B extends { trashedAt?: number }>(incoming: B, base: { trashedAt?: number } | undefined) =>
  incoming.trashedAt !== undefined && base?.trashedAt !== undefined ? { ...incoming, trashedAt: base.trashedAt } : incoming;

const labelIdsFor = async (ctx: QueryCtx, tags: string[]) => {
  const ids: Id<"labels">[] = [];
  for (const tag of tags) {
    const label = await linked.labels(ctx, tag);
    if (label && !ids.includes(label._id)) ids.push(label._id);
  }
  return ids;
};

const parentFor = async (ctx: QueryCtx, parent: ThingsParent) => {
  if (parent.kind === "project") {
    const project = await linked.projects(ctx, parent.project);
    if (!project) return { kind: "loose" } satisfies Parent;
    const heading = parent.heading ? await linked.headings(ctx, parent.heading) : null;
    return heading?.projectId === project._id
      ? ({ kind: "project", projectId: project._id, headingId: heading._id } satisfies Parent)
      : ({ kind: "project", projectId: project._id } satisfies Parent);
  }
  if (parent.kind === "area") {
    const area = await linked.areas(ctx, parent.area);
    return area ? ({ kind: "area", areaId: area._id } satisfies Parent) : ({ kind: "loose" } satisfies Parent);
  }
  return parent;
};

const lastOrder = async (ctx: QueryCtx, table: "areas" | "labels") =>
  (await ctx.db.query(table).withIndex("by_order").order("desc").first())?.order;

const stayOpen = Effect.fn("thingsImport.stayOpen")(function* () {
  const retiredAt = yield* reading(retiredAtOf);
  if (retiredAt !== undefined) return yield* new Retired({ retiredAt });
});

const stage = <V extends GenericValidator>(
  records: V,
  importOne: (ctx: MutationCtx, record: Recorder, incoming: Infer<V>) => Promise<Outcome | Skipped>,
) =>
  internalMutation({
    args: { records: v.array(records) },
    handler: Effect.fn("thingsImport.stage")(function* ({ records: batch }) {
      return yield* asWire(
        Effect.gen(function* () {
          yield* stayOpen();
          const ctx = yield* Writes;
          const record = startRecording(ctx, { kind: "things" }, "things.import");
          const counts: StageCounts = { inserted: 0, updated: 0, unchanged: 0 };
          const skipped: Skipped[] = [];
          for (const incoming of batch as Infer<V>[]) {
            const outcome = yield* writing((writes) => importOne(writes, record, incoming));
            if (typeof outcome === "string") counts[outcome] += 1;
            else skipped.push(outcome);
          }
          yield* Effect.promise(() => record.finish());
          return { counts, skipped };
        }),
      );
    }),
  });

export const importAreas = stage(vIncomingArea, async (ctx, record, { uuid, title, colour }) => {
  const link = { id: uuid, base: { title } };
  const existing = await linked.areas(ctx, uuid);
  if (existing) return mergeInto(ctx, record, "areas", existing, link);
  if (await isBuried(ctx, uuid)) return "unchanged";
  await record.insert("areas", { title, colour, order: keyAfter(await lastOrder(ctx, "areas")), things: link });
  return "inserted";
});

export const importLabels = stage(vIncomingLabel, async (ctx, record, { uuid, name }) => {
  const link = { id: uuid, base: { name } };
  const existing = (await linked.labels(ctx, uuid)) ?? (await labelNamed(ctx, name));
  if (existing && (existing.things === undefined || existing.things.id === uuid)) {
    return mergeInto(ctx, record, "labels", existing, link);
  }
  if (await isBuried(ctx, uuid)) return "unchanged";
  await record.insert("labels", { name, colour: "slate", order: keyAfter(await lastOrder(ctx, "labels")), things: link });
  return "inserted";
});

export const importProjects = stage(vIncomingProject, async (ctx, record, { uuid, area, tags, ...fields }) => {
  const existing = await linked.projects(ctx, uuid);
  const areaId = area === undefined ? undefined : (await linked.areas(ctx, area))?._id;
  const base = withoutUndefined(
    keepTrashedAt({ ...fields, areaId, labelIds: await labelIdsFor(ctx, tags) }, existing?.things?.base),
  );
  const link = { id: uuid, base };
  if (existing) return mergeInto(ctx, record, "projects", existing, link);
  if (await isBuried(ctx, uuid)) return "unchanged";
  const last = await ctx.db
    .query("projects")
    .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
    .order("desc")
    .first();
  await record.insert("projects", { ...base, order: keyAfter(last?.order), things: link });
  return "inserted";
});

export const importHeadings = stage(vIncomingHeading, async (ctx, record, { uuid, title, project }) => {
  const projectId = (await linked.projects(ctx, project))?._id;
  if (!projectId) return { uuid, title, reason: "missing_parent" } satisfies Skipped;
  const link = { id: uuid, base: { title, projectId } };
  const existing = await linked.headings(ctx, uuid);
  if (existing) return mergeInto(ctx, record, "headings", existing, link);
  if (await isBuried(ctx, uuid)) return "unchanged";
  const last = await ctx.db
    .query("headings")
    .withIndex("by_project_order", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
  await record.insert("headings", { title, projectId, order: keyAfter(last?.order), things: link });
  return "inserted";
});

export const importTasks = stage(vIncomingTask, async (ctx, record, { uuid, todayIndex, parent, tags, ...fields }) => {
  const existing = await linked.tasks(ctx, uuid);
  const base = withoutUndefined(
    keepTrashedAt(
      { ...fields, parent: await parentFor(ctx, parent), labelIds: await labelIdsFor(ctx, tags) },
      existing?.things?.base,
    ),
  );
  const link = { id: uuid, todayIndex, base };
  if (existing) return mergeInto(ctx, record, "tasks", existing, link);
  if (await isBuried(ctx, uuid)) return "unchanged";
  await record.insert("tasks", { ...base, order: keyAfter(await lastTaskOrder(ctx, base.parent)), things: link });
  return "inserted";
});

export const importChecklistItems = stage(vIncomingChecklistItem, async (ctx, record, { uuid, task, title, done }) => {
  const taskId = (await linked.tasks(ctx, task))?._id;
  if (!taskId) return { uuid, title, reason: "missing_parent" } satisfies Skipped;
  const link = { id: uuid, base: { title, done } };
  const existing = await linked.checklistItems(ctx, uuid);
  if (existing) return mergeInto(ctx, record, "checklistItems", existing, link);
  if (await isBuried(ctx, uuid)) return "unchanged";
  const last = await ctx.db
    .query("checklistItems")
    .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
    .order("desc")
    .first();
  await record.insert("checklistItems", { taskId, title, done, order: keyAfter(last?.order), things: link });
  return "inserted";
});

const vTableCounts = v.object({
  areas: v.number(),
  projects: v.number(),
  headings: v.number(),
  tasks: v.number(),
  checklistItems: v.number(),
  labels: v.number(),
});

export const finish = internalMutation({
  args: { counts: vTableCounts },
  handler: Effect.fn("thingsImport.finish")(function* ({ counts }) {
    return yield* asWire(
      Effect.gen(function* () {
        const state = yield* reading(syncState);
        if (state?.retiredAt !== undefined) return yield* new Retired({ retiredAt: state.retiredAt });
        const synced = { syncedAt: yield* Clock.currentTimeMillis, counts };
        if (state) yield* writing((ctx) => ctx.db.replace("thingsSync", state._id, synced));
        else yield* writing((ctx) => ctx.db.insert("thingsSync", synced));
        return { syncedAt: synced.syncedAt };
      }),
    );
  }),
});

export const retiredAt = internalQuery({
  args: {},
  handler: () => reading(async (ctx) => (await retiredAtOf(ctx)) ?? null),
});

import { v } from "convex/values";
import { Clock, Effect } from "effect";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { asWire, type Wire } from "../../shared/result";
import { fromStored, recordedFields, sameValue, startRecording } from "./activity";
import { CurrentActor, ownerMutation, reading, writing } from "./effect";
import { ActivityNotFound, AlreadyUndone, ChangedSince, NothingToUndo, NotUndoable, RunActive, type UndoFailure } from "./errors";
import { vEntityRef, type Actor, type EntityRef, type RecordRef, type UndoTarget } from "./tables";

export type UndoError = Wire<UndoFailure>;

type Expected = { entity: RecordRef; fields: Map<string, unknown> | null; exact: boolean };

const DEPENDENT_SCAN_LIMIT = 100;
const PERMANENT_ACTIONS = new Set(["trash.delete", "trash.empty", "label.remove"]);

const LINKABLE_TABLES = new Set<string>(vEntityRef.members.map((member) => member.fields.table.value));

const isLinkable = (entity: RecordRef): entity is EntityRef => LINKABLE_TABLES.has(entity.table);

const changesOf = (activityId: Id<"activity">) =>
  reading((ctx) =>
    ctx.db
      .query("activityChanges")
      .withIndex("by_activity_seq", (q) => q.eq("activityId", activityId))
      .take(4000),
  );

const runUndone = (jobId: Id<"jobs">) =>
  reading(
    async (ctx) =>
      (await ctx.db
        .query("activity")
        .withIndex("by_undoes_run", (q) => q.eq("undoes.jobId", jobId))
        .first()) !== null,
  );

const isUndone = Effect.fn("undo.isUndone")(function* (activity: Doc<"activity">) {
  const direct = yield* reading((ctx) =>
    ctx.db
      .query("activity")
      .withIndex("by_undoes_activity", (q) => q.eq("undoes.activityId", activity._id))
      .first(),
  );
  if (direct) return true;
  return activity.actor.kind === "agentRun" && (yield* runUndone(activity.actor.jobId));
});

const expectedState = (changes: Doc<"activityChanges">[]) => {
  const expected = new Map<string, Expected>();
  for (const { entity, change } of changes) {
    if (change.kind === "delete") {
      expected.set(entity.id, { entity, fields: null, exact: false });
    } else if (change.kind === "insert") {
      expected.set(entity.id, { entity, fields: new Map(Object.entries(change.after)), exact: true });
    } else {
      const known = expected.get(entity.id) ?? { entity, fields: new Map<string, unknown>(), exact: false };
      const fields = known.fields ?? new Map<string, unknown>();
      for (const [key, value] of Object.entries(change.after)) fields.set(key, value);
      expected.set(entity.id, { ...known, fields });
    }
  }
  return [...expected.values()];
};

const dependentsOf = async (ctx: QueryCtx, entity: RecordRef) => {
  if (!isLinkable(entity)) return [];
  const links = [
    ...(await ctx.db
      .query("entityLinks")
      .withIndex("by_from", (q) => q.eq("from.id", entity.id))
      .take(DEPENDENT_SCAN_LIMIT)),
    ...(await ctx.db
      .query("entityLinks")
      .withIndex("by_to", (q) => q.eq("to.id", entity.id))
      .take(DEPENDENT_SCAN_LIMIT)),
  ].filter(({ from }) => from.table !== "notes");
  if (entity.table !== "tasks") return links.map(({ _id }) => _id as string);
  const [items, blocks, sessions] = await Promise.all([
    ctx.db
      .query("checklistItems")
      .withIndex("by_task_order", (q) => q.eq("taskId", entity.id))
      .take(DEPENDENT_SCAN_LIMIT),
    ctx.db
      .query("workBlocks")
      .withIndex("by_task_start", (q) => q.eq("taskId", entity.id))
      .take(DEPENDENT_SCAN_LIMIT),
    ctx.db
      .query("focusSessions")
      .withIndex("by_task_start", (q) => q.eq("taskId", entity.id))
      .take(DEPENDENT_SCAN_LIMIT),
  ]);
  return [...links, ...items, ...blocks, ...sessions].map(({ _id }) => _id as string);
};

const OWNER_KEYS = ["taskId", "from", "to"];

const releasedIn = (changes: Doc<"activityChanges">[]) =>
  new Set(
    changes.flatMap(({ entity, change }) =>
      change.kind === "insert" || (change.kind === "patch" && OWNER_KEYS.some((key) => key in change.before))
        ? [entity.id as string]
        : [],
    ),
  );

const transientIn = (changes: Doc<"activityChanges">[]) => {
  const first = new Map<string, string>();
  const last = new Map<string, string>();
  for (const { entity, change } of changes) {
    if (!first.has(entity.id)) first.set(entity.id, change.kind);
    last.set(entity.id, change.kind);
  }
  return new Set([...first].flatMap(([id, kind]) => (kind === "insert" && last.get(id) === "delete" ? [id] : [])));
};

const firstConflict = async (ctx: QueryCtx, changes: Doc<"activityChanges">[]) => {
  const removedByUndo = releasedIn(changes);
  for (const { entity, fields, exact } of expectedState(changes)) {
    const doc = await ctx.db.get(entity.id);
    if (fields === null) {
      if (doc) return entity;
      continue;
    }
    if (!doc) return entity;
    const current: Record<string, unknown> = recordedFields(doc);
    const keys = exact ? new Set([...fields.keys(), ...Object.keys(current)]) : new Set(fields.keys());
    if ([...keys].some((key) => !sameValue(current[key], fields.get(key)))) return entity;
    if (exact && (await dependentsOf(ctx, entity)).some((id) => !removedByUndo.has(id))) return entity;
  }
  return null;
};

const revertAll = async (ctx: MutationCtx, actor: Actor, undoes: UndoTarget, changes: Doc<"activityChanges">[]) => {
  const record = startRecording(ctx, actor, "undo", undoes);
  const transient = transientIn(changes);
  for (const { entity, change } of changes.toReversed()) {
    if (transient.has(entity.id)) continue;
    if (change.kind === "insert") await record.remove(entity.table, entity.id);
    else if (change.kind === "patch") await record.patch(entity.table, entity.id, fromStored(change.before));
    else await record.insert(entity.table, fromStored(change.before) as never);
  }
  return record.finish();
};

const revert = Effect.fn("undo.revert")(function* (actor: Actor, undoes: UndoTarget, changes: Doc<"activityChanges">[]) {
  const conflict = yield* reading((ctx) => firstConflict(ctx, changes));
  if (conflict) return yield* new ChangedSince({ entity: conflict });
  return { undoActivityId: yield* writing((ctx) => revertAll(ctx, actor, undoes, changes)) };
});

export const undoActivity = Effect.fn("undo.activity")(function* (actor: Actor, activityId: Id<"activity">) {
  const activity = yield* reading((ctx) => ctx.db.get("activity", activityId));
  if (!activity) return yield* new ActivityNotFound();
  if (activity.undoes) return yield* new NotUndoable({ reason: "undo" });
  if (activity.actor.kind === "things" || activity.actor.kind === "recurrence") {
    return yield* new NotUndoable({ reason: activity.actor.kind });
  }
  if (PERMANENT_ACTIONS.has(activity.action)) return yield* new NotUndoable({ reason: "permanent" });
  if (yield* isUndone(activity)) return yield* new AlreadyUndone();
  return yield* revert(actor, { kind: "activity", activityId }, yield* changesOf(activityId));
});

export const undoAgentRun = Effect.fn("undo.agentRun")(function* (actor: Actor, jobId: Id<"jobs">) {
  if (yield* runUndone(jobId)) return yield* new AlreadyUndone();
  const run = yield* reading((ctx) => ctx.db.get("jobs", jobId));
  const now = yield* Clock.currentTimeMillis;
  if (run?.status.kind === "claimed" && run.status.leaseUntil >= now) return yield* new RunActive();
  const groups = yield* reading((ctx) =>
    ctx.db
      .query("activity")
      .withIndex("by_run", (q) => q.eq("actor.jobId", jobId))
      .take(1000),
  );
  const standing = [];
  for (const group of groups) {
    if (group.undoes || (yield* isUndone(group))) continue;
    standing.push(group);
  }
  if (standing.length === 0) return yield* new NothingToUndo();
  const changes = (yield* Effect.forEach(standing, (group) => changesOf(group._id))).flat();
  return yield* revert(actor, { kind: "run", jobId }, changes);
});

export const undo = ownerMutation({
  args: { activityId: v.id("activity") },
  handler: ({ activityId }) => Effect.flatMap(CurrentActor, (actor) => asWire(undoActivity(actor, activityId))),
});

export const undoRun = ownerMutation({
  args: { jobId: v.id("jobs") },
  handler: ({ jobId }) => Effect.flatMap(CurrentActor, (actor) => asWire(undoAgentRun(actor, jobId))),
});

import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { nothingTouched, noteWrite, settle } from "../planner/rollups";
import type { Actor, Change, RecordRef, UndoTarget } from "./tables";
import { indexChanged } from "../ai/indexRows";
import type { IndexedRef } from "../ai/tables";

type RecordTable = RecordRef["table"];
type Fields = Record<string, unknown>;

const unrecordedKeys = new Set(["_id", "_creationTime", "things", "rollup", "progress"]);

const canonical = (value: unknown) =>
  JSON.stringify(value ?? null, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export const recordedFields = (doc: object) =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => !unrecordedKeys.has(key)));

export const toStored = (fields: Fields) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? null]));

export const fromStored = (fields: Fields) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === null ? undefined : value]));

const pick = (fields: Fields, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, fields[key]]));

const INDEXED = new Set(["tasks", "projects", "areas"]);

const indexedRefs = (table: string, id: string, docs: (Fields | null)[]) => {
  if (INDEXED.has(table)) return [{ table, id } as IndexedRef];
  if (table !== "checklistItems") return [];
  return docs.flatMap((doc) => (typeof doc?.taskId === "string" ? [{ table: "tasks", id: doc.taskId } as IndexedRef] : []));
};

export const startRecording = (ctx: MutationCtx, actor: Actor, action: string, undoes?: UndoTarget) => {
  let activityId: Id<"activity"> | null = null;
  let seq = 0;
  const touched = nothingTouched();
  const stale: IndexedRef[] = [];

  const log = async (entity: RecordRef, change: Change) => {
    activityId ??= await ctx.db.insert("activity", { actor, action, at: Date.now(), ...(undoes ? { undoes } : {}) });
    await ctx.db.insert("activityChanges", { activityId, seq, entity, change });
    seq += 1;
  };

  const insert = async <T extends RecordTable>(table: T, doc: WithoutSystemFields<Doc<T>>) => {
    const id = await ctx.db.insert(table, doc);
    noteWrite(touched, table, id, null, doc);
    stale.push(...indexedRefs(table, id, [doc]));
    await log({ table, id } as RecordRef, { kind: "insert", after: toStored(recordedFields(doc)) });
    return id;
  };

  const patch = async <T extends RecordTable>(table: T, id: Id<T>, fields: Partial<WithoutSystemFields<Doc<T>>>) => {
    const current = await ctx.db.get(id);
    if (!current) return false;
    const keys = Object.keys(fields).filter(
      (key) => !unrecordedKeys.has(key) && !sameValue((current as Fields)[key], (fields as Fields)[key]),
    );
    if (keys.length === 0) return false;
    const after = pick(fields, keys);
    await ctx.db.patch(id, after as never);
    noteWrite(touched, table, id, current, { ...current, ...after });
    stale.push(...indexedRefs(table, id, [current]));
    await log(
      { table, id } as RecordRef,
      { kind: "patch", before: toStored(pick(current, keys)), after: toStored(after) },
    );
    return true;
  };

  const remove = async <T extends RecordTable>(table: T, id: Id<T>) => {
    const current = await ctx.db.get(id);
    if (!current) return false;
    await ctx.db.delete(id);
    noteWrite(touched, table, id, current, null);
    stale.push(...indexedRefs(table, id, [current]));
    await log({ table, id } as RecordRef, { kind: "delete", before: toStored(recordedFields(current)) });
    return true;
  };

  const finish = async () => {
    await settle(ctx, touched);
    await indexChanged(ctx, stale);
    return activityId;
  };

  return { insert, patch, remove, finish };
};

export type Recorder = ReturnType<typeof startRecording>;

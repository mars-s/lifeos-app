import type { WithoutSystemFields } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { thingsOwnedFields } from "../planner/tables";
import { enqueueJob } from "./jobs";
import type { Actor, Change, RecordRef, UndoTarget } from "./tables";

type RecordTable = RecordRef["table"];
type Fields = Record<string, unknown>;
type ThingsOp = "create" | "update" | "delete";

const unrecordedKeys = new Set(["_id", "_creationTime", "things"]);

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

const thingsOwnedKeys = (table: RecordTable) =>
  table in thingsOwnedFields ? thingsOwnedFields[table as keyof typeof thingsOwnedFields] : [];

const changedKeys = (change: Change) =>
  Object.keys(change.kind === "delete" ? change.before : change.after);

const thingsIdOf = (doc: object) => {
  const link: unknown = (doc as { things?: unknown }).things;
  return link && typeof link === "object" && "id" in link && typeof link.id === "string" ? link.id : undefined;
};

export const startRecording = (ctx: MutationCtx, actor: Actor, action: string, undoes?: UndoTarget) => {
  let activityId: Id<"activity"> | null = null;
  let seq = 0;
  const bridged = new Map<string, { entity: RecordRef; op: ThingsOp; keys: Set<string>; thingsId?: string }>();

  const noteBridged = (entity: RecordRef, change: Change, doc: object) => {
    if (actor.kind === "things") return;
    const owned = thingsOwnedKeys(entity.table);
    const touched = changedKeys(change).filter((key) => (owned as readonly string[]).includes(key));
    if (touched.length === 0) return;
    const op: ThingsOp = change.kind === "insert" ? "create" : change.kind === "delete" ? "delete" : "update";
    const previous = bridged.get(entity.id);
    bridged.set(entity.id, {
      entity,
      op: previous?.op === "create" && op === "update" ? "create" : op,
      keys: new Set([...(previous?.keys ?? []), ...(op === "create" ? owned : touched)]),
      thingsId: thingsIdOf(doc) ?? previous?.thingsId,
    });
  };

  const log = async (entity: RecordRef, change: Change, doc: object) => {
    activityId ??= await ctx.db.insert("activity", { actor, action, at: Date.now(), ...(undoes ? { undoes } : {}) });
    await ctx.db.insert("activityChanges", { activityId, seq, entity, change });
    seq += 1;
    noteBridged(entity, change, doc);
  };

  const insert = async <T extends RecordTable>(table: T, doc: WithoutSystemFields<Doc<T>>) => {
    const id = await ctx.db.insert(table, doc);
    await log({ table, id } as RecordRef, { kind: "insert", after: toStored(recordedFields(doc)) }, doc);
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
    await log(
      { table, id } as RecordRef,
      { kind: "patch", before: toStored(pick(current, keys)), after: toStored(after) },
      current,
    );
    return true;
  };

  const remove = async <T extends RecordTable>(table: T, id: Id<T>) => {
    const current = await ctx.db.get(id);
    if (!current) return false;
    await ctx.db.delete(id);
    await log({ table, id } as RecordRef, { kind: "delete", before: toStored(recordedFields(current)) }, current);
    return true;
  };

  const finish = async () => {
    if (!activityId) return null;
    for (const { entity, op, keys, thingsId } of bridged.values()) {
      const doc = op === "delete" ? null : await ctx.db.get(entity.id);
      await enqueueJob(
        ctx,
        {
          kind: "things",
          payload: {
            op,
            entity,
            ...(thingsId ? { thingsId } : {}),
            set: doc ? toStored(pick(doc, [...keys])) : {},
          },
        },
        `things:${activityId}:${entity.id}`,
      );
    }
    return activityId;
  };

  return { insert, patch, remove, finish };
};

export type Recorder = ReturnType<typeof startRecording>;

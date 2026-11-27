import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "../platform/workers";
import type { IndexedRef, IndexKind } from "./tables";

const SNIPPET = 300;
const NOTES = 1000;
const CHECKLIST = 30;
const EMBED_DELAY_MS = 30_000;

const embedLater = makeFunctionReference<"action", Record<string, never>, null>("ai/aiIndex:embedPending");

const mayEmbed = async (ctx: QueryCtx) => {
  const ai = await ctx.db
    .query("features")
    .withIndex("by_feature", (q) => q.eq("feature", "ai"))
    .unique();
  if (ai?.enabled !== true) return false;
  const key = await ctx.db
    .query("secrets")
    .withIndex("by_name", (q) => q.eq("name", "openai"))
    .unique();
  return key !== null || process.env.OPENAI_API_KEY !== undefined;
};

type Described = { kind: IndexKind; text: string; areaId?: Id<"areas"> };

const lines = (...parts: (string | undefined | null | false)[]) => parts.filter((part): part is string => typeof part === "string" && part.trim() !== "").join("\n");

const titleOf = async <T extends "areas" | "projects">(ctx: QueryCtx, table: T, id: Id<T> | undefined) => (id ? ((await ctx.db.get(table, id))?.title ?? null) : null);

const describeTask = async (ctx: QueryCtx, task: Doc<"tasks">) => {
  const project = task.parent.kind === "project" ? await ctx.db.get("projects", task.parent.projectId) : null;
  const areaId = task.parent.kind === "area" ? task.parent.areaId : project?.areaId;
  const checklist = await ctx.db
    .query("checklistItems")
    .withIndex("by_task_order", (q) => q.eq("taskId", task._id))
    .take(CHECKLIST);
  return {
    kind: "task",
    text: lines(
      task.title,
      task.notes.slice(0, NOTES),
      checklist.length > 0 && `Checklist: ${checklist.map((item) => item.title).join("; ")}`,
      project && `Project: ${project.title}`,
      areaId && `Area: ${(await titleOf(ctx, "areas", areaId)) ?? ""}`,
    ),
    ...(areaId ? { areaId } : {}),
  } satisfies Described;
};

export const describe = async (ctx: QueryCtx, ref: IndexedRef) => {
  if (ref.table === "tasks") {
    const task = await ctx.db.get("tasks", ref.id);
    return task && task.trashedAt === undefined ? describeTask(ctx, task) : null;
  }
  if (ref.table === "projects") {
    const project = await ctx.db.get("projects", ref.id);
    if (!project || project.trashedAt !== undefined) return null;
    return {
      kind: "project",
      text: lines(project.title, project.notes.slice(0, NOTES), project.areaId && `Area: ${(await titleOf(ctx, "areas", project.areaId)) ?? ""}`),
      ...(project.areaId ? { areaId: project.areaId } : {}),
    } satisfies Described;
  }
  const area = await ctx.db.get("areas", ref.id);
  return area && area.trashedAt === undefined ? ({ kind: "area", text: area.title, areaId: area._id } satisfies Described) : null;
};

const rowOf = (ctx: QueryCtx, id: string) =>
  ctx.db
    .query("aiIndex")
    .withIndex("by_entity", (q) => q.eq("entity.id", id as Id<"tasks">))
    .unique();

const refresh = async (ctx: MutationCtx, ref: IndexedRef) => {
  const [described, row] = await Promise.all([describe(ctx, ref), rowOf(ctx, ref.id)]);
  if (!described) {
    if (row) await ctx.db.delete("aiIndex", row._id);
    return false;
  }
  const hash = await sha256Hex(described.text);
  if (row?.hash === hash) return false;
  const fields = { entity: ref, kind: described.kind, text: described.text.slice(0, SNIPPET), hash, embedded: false, updatedAt: Date.now(), ...(described.areaId ? { areaId: described.areaId } : {}) };
  if (row) await ctx.db.replace("aiIndex", row._id, fields);
  else await ctx.db.insert("aiIndex", fields);
  return true;
};

export const indexChanged = async (ctx: MutationCtx, refs: Iterable<IndexedRef>) => {
  const unique = new Map<string, IndexedRef>();
  for (const ref of refs) unique.set(ref.id, ref);
  let changed = false;
  for (const ref of unique.values()) changed = (await refresh(ctx, ref)) || changed;
  if (changed && (await mayEmbed(ctx))) await ctx.scheduler.runAfter(EMBED_DELAY_MS, embedLater, {});
};


import { v } from "convex/values";
import { err, ok } from "neverthrow";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import { vEntityRef, type EntityRef } from "../platform/tables";

const LIST_LIMIT = 1000;
const SEARCH_LIMIT = 20;
const CHANGED_LIMIT = 500;
const LINK_LIMIT = 200;

export type NoteError = { readonly kind: "not_found" };

export const noteRow = (note: Doc<"notes">) => ({
  id: note._id,
  docId: note.docId,
  title: note.title,
  excerpt: note.excerpt,
  words: note.words,
  areaId: note.areaId,
  projectId: note.projectId,
  labelIds: note.labelIds,
  day: note.day,
  updatedAt: note.updatedAt,
  trashedAt: note.trashedAt,
});

export type NoteRow = ReturnType<typeof noteRow>;

const isLive = (note: Doc<"notes"> | null): note is Doc<"notes"> => note !== null && note.trashedAt === undefined;

export const list = ownerQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("notes")
        .withIndex("by_trashed", (q) => q.eq("trashedAt", undefined))
        .take(LIST_LIMIT)
    )
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map(noteRow),
});

export const searchNotes = async (ctx: QueryCtx, query: string, limit = SEARCH_LIMIT) => {
  const words = query.trim();
  if (words.length === 0) return [];
  const hits = await ctx.db
    .query("notes")
    .withSearchIndex("search_text", (q) => q.search("searchText", words))
    .take(Math.min(limit, 50) * 2);
  return hits.filter(isLive).slice(0, limit).map(noteRow);
};

export const search = ownerQuery({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: (ctx, { query, limit }) => searchNotes(ctx, query, limit),
});

const byDoc = (ctx: QueryCtx, docId: string) =>
  ctx.db
    .query("notes")
    .withIndex("by_doc", (q) => q.eq("docId", docId))
    .unique();

export const get = ownerQuery({
  args: { docId: v.string() },
  handler: async (ctx, { docId }) => {
    const note = await byDoc(ctx, docId);
    return note ? noteRow(note) : null;
  },
});

export const changedSince = ownerQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) =>
    (
      await ctx.db
        .query("notes")
        .withIndex("by_updated", (q) => q.gt("updatedAt", since))
        .take(CHANGED_LIMIT)
    ).map(noteRow),
});

const notesLinkingTo = async (ctx: QueryCtx, id: EntityRef["id"]) => {
  const links = await ctx.db
    .query("entityLinks")
    .withIndex("by_to", (q) => q.eq("to.id", id))
    .take(LINK_LIMIT);
  const notes = await Promise.all(
    links.flatMap(({ from }) => (from.table === "notes" ? [ctx.db.get("notes", from.id)] : [])),
  );
  return notes.filter(isLive).map(noteRow);
};

export const forEntity = ownerQuery({
  args: { entity: vEntityRef },
  handler: (ctx, { entity }) => notesLinkingTo(ctx, entity.id),
});

export const linksOf = async (ctx: QueryCtx, note: Doc<"notes">) => {
  const outgoing = await ctx.db
    .query("entityLinks")
    .withIndex("by_from", (q) => q.eq("from.id", note._id))
    .take(LINK_LIMIT);
  const out = await Promise.all(
    outgoing.map(async ({ to }) => {
      if (to.table === "notes") {
        const target = await ctx.db.get("notes", to.id);
        return isLive(target) ? { kind: "note" as const, note: noteRow(target) } : null;
      }
      if (to.table === "tasks" || to.table === "projects" || to.table === "areas") {
        const target = await ctx.db.get(to.table, to.id as Id<"tasks" | "projects" | "areas">);
        if (!target || ("trashedAt" in target && target.trashedAt !== undefined)) return null;
        return { kind: "entity" as const, table: to.table, id: to.id as string, title: target.title };
      }
      return null;
    }),
  );
  return { linkedFrom: await notesLinkingTo(ctx, note._id), linksOut: out.filter((link) => link !== null) };
};

export const links = ownerQuery({
  args: { docId: v.string() },
  handler: async (ctx, { docId }) => {
    const note = await byDoc(ctx, docId);
    return note ? linksOf(ctx, note) : { linkedFrom: [], linksOut: [] };
  },
});

export const trash = changeMutation({
  action: "note.trash",
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }, record) => {
    const note = await ctx.db.get("notes", noteId);
    if (!note) return err<{ changed: boolean }, NoteError>({ kind: "not_found" });
    if (note.trashedAt !== undefined) return ok({ changed: false });
    await record.patch("notes", noteId, { trashedAt: Date.now() });
    return ok({ changed: true });
  },
});

export const restore = changeMutation({
  action: "note.restore",
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }, record) => {
    const note = await ctx.db.get("notes", noteId);
    if (!note) return err<{ changed: boolean }, NoteError>({ kind: "not_found" });
    if (note.trashedAt === undefined) return ok({ changed: false });
    await record.patch("notes", noteId, { trashedAt: undefined });
    return ok({ changed: true });
  },
});

const SUGGEST_LIMIT = 8;

const entityOf = async (ctx: QueryCtx, id: string) => {
  const taskId = ctx.db.normalizeId("tasks", id);
  if (taskId) {
    const task = await ctx.db.get("tasks", taskId);
    if (!task) return null;
    return {
      id,
      table: "tasks" as const,
      title: task.title,
      done: task.status.kind === "completed",
      trashed: task.trashedAt !== undefined,
    };
  }
  const projectId = ctx.db.normalizeId("projects", id);
  if (projectId) {
    const project = await ctx.db.get("projects", projectId);
    if (!project) return null;
    const area = project.areaId ? await ctx.db.get("areas", project.areaId) : null;
    const progress = project.progress && project.progress.total > 0 ? project.progress.done / project.progress.total : 0;
    return { id, table: "projects" as const, title: project.title, progress, colour: area?.colour, trashed: project.trashedAt !== undefined };
  }
  const areaId = ctx.db.normalizeId("areas", id);
  if (areaId) {
    const area = await ctx.db.get("areas", areaId);
    if (!area) return null;
    return { id, table: "areas" as const, title: area.title, colour: area.colour, trashed: area.trashedAt !== undefined };
  }
  return null;
};

export const entities = ownerQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) =>
    (await Promise.all([...new Set(ids)].slice(0, LINK_LIMIT).map((id) => entityOf(ctx, id)))).filter(
      (entity) => entity !== null,
    ),
});

export const suggest = ownerQuery({
  args: { query: v.string() },
  handler: async (ctx, { query }) => {
    const words = query.trim();
    const lower = words.toLowerCase();
    const tasks =
      words.length === 0
        ? []
        : (
            await ctx.db
              .query("tasks")
              .withSearchIndex("search_title", (q) => q.search("title", words).eq("status.kind", "open"))
              .take(SUGGEST_LIMIT * 2)
          )
            .filter((task) => task.trashedAt === undefined)
            .slice(0, SUGGEST_LIMIT)
            .map((task) => ({ id: task._id as string, title: task.title }));
    const fits = (title: string) => lower.length === 0 || title.toLowerCase().includes(lower);
    const projects = (await ctx.db.query("projects").withIndex("by_trashed", (q) => q.eq("trashedAt", undefined)).take(500))
      .filter((project) => project.status.kind === "open" && fits(project.title))
      .slice(0, SUGGEST_LIMIT)
      .map((project) => ({ id: project._id as string, title: project.title }));
    const areas = (await ctx.db.query("areas").withIndex("by_trashed", (q) => q.eq("trashedAt", undefined)).take(200))
      .filter((area) => fits(area.title))
      .slice(0, SUGGEST_LIMIT)
      .map((area) => ({ id: area._id as string, title: area.title }));
    return { tasks, projects, areas };
  },
});

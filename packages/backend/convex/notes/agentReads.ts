import { tool, type ToolDefinition } from "@convex-dev/mcp";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { agentQuery, MCP_SCOPES } from "../platform/access";
import { linksOf, noteRow, searchNotes, type NoteRow } from "./notes";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const vNoteSummary = v.object({
  noteId: v.string(),
  title: v.string(),
  excerpt: v.string(),
  edited: v.string(),
  area: v.optional(v.string()),
  project: v.optional(v.string()),
  labels: v.array(v.string()),
  day: v.optional(v.string()),
  words: v.number(),
});

const vNoteList = v.object({ notes: v.array(vNoteSummary), omitted: v.number() });

const vNoteDetail = v.object({
  note: vNoteSummary,
  linksOut: v.array(v.object({ kind: v.string(), id: v.string(), title: v.string() })),
  linkedFrom: v.array(v.object({ noteId: v.string(), title: v.string() })),
});

const summarise = async (ctx: QueryCtx, row: NoteRow) => {
  const [area, project, labels] = await Promise.all([
    row.areaId ? ctx.db.get("areas", row.areaId) : null,
    row.projectId ? ctx.db.get("projects", row.projectId) : null,
    Promise.all(row.labelIds.map((id) => ctx.db.get("labels", id))),
  ]);
  return {
    noteId: row.docId,
    title: row.title,
    excerpt: row.excerpt,
    edited: new Date(row.updatedAt).toISOString(),
    ...(area ? { area: area.title } : {}),
    ...(project ? { project: project.title } : {}),
    labels: labels.flatMap((label) => (label ? [label.name] : [])),
    ...(row.day ? { day: row.day } : {}),
    words: row.words,
  };
};

const clamp = (limit: number | undefined) => Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT));

export const listNotes = agentQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const live = (
      await ctx.db
        .query("notes")
        .withIndex("by_trashed", (q) => q.eq("trashedAt", undefined))
        .take(1000)
    ).toSorted((a, b) => b.updatedAt - a.updatedAt);
    const shown = live.slice(0, clamp(limit));
    return {
      notes: await Promise.all(shown.map((note) => summarise(ctx, noteRow(note)))),
      omitted: live.length - shown.length,
    };
  },
});

export const searchNotesTool = agentQuery({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query, limit }) => {
    const hits = await searchNotes(ctx, query, Math.min(clamp(limit), 50));
    return { notes: await Promise.all(hits.map((row) => summarise(ctx, row))), omitted: 0 };
  },
});

export const getNote = agentQuery({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const note = await ctx.db
      .query("notes")
      .withIndex("by_doc", (q) => q.eq("docId", noteId))
      .unique();
    if (!note || note.trashedAt !== undefined) {
      throw new ConvexError(`No note has the id "${noteId}". Use list_notes or search_notes to find one.`);
    }
    const links = await linksOf(ctx, note);
    return {
      note: await summarise(ctx, noteRow(note)),
      linksOut: links.linksOut.map((link) =>
        link.kind === "note"
          ? { kind: "note", id: link.note.docId, title: link.note.title }
          : { kind: link.table.replace(/s$/, ""), id: link.id, title: link.title },
      ),
      linkedFrom: links.linkedFrom.map((row) => ({ noteId: row.docId, title: row.title })),
    };
  },
});

export const notesReadTools: Record<string, ToolDefinition> = {
  list_notes: tool({
    title: "List notes",
    description:
      "List Avi's notes, most recently edited first: title, a short excerpt, Area, Project, Labels and the day for a daily note. Returns at most `limit` (default 30, max 100) and says how many were left out. The full text stays on his devices; this is the searchable copy.",
    args: { limit: v.optional(v.number()) },
    returns: vNoteList,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.notes.agentReads.listNotes, { ...args, caller }),
  }),
  search_notes: tool({
    title: "Search notes",
    description: "Find notes by words in their title, excerpt or Labels. Returns up to `limit` (default 30, max 50).",
    args: { query: v.string(), limit: v.optional(v.number()) },
    returns: vNoteList,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.notes.agentReads.searchNotesTool, { ...args, caller }),
  }),
  get_note: tool({
    title: "Get note",
    description:
      "Read one note's searchable copy by its noteId: title, excerpt, Area, Project, Labels, the Tasks, Projects, Areas and notes it links to, and the notes that link to it.",
    args: { noteId: v.string() },
    returns: vNoteDetail,
    annotations: { readOnlyHint: true },
    scope: MCP_SCOPES.read,
    handler: (ctx, args, caller) => ctx.runQuery(internal.notes.agentReads.getNote, { ...args, caller }),
  }),
};

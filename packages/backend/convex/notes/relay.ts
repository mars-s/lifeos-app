import { v, type Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { workerMutation } from "../platform/access";
import type { EntityRef } from "../platform/tables";
import { requireCapability } from "../platform/workers";
import { vNoteEntity, vNoteFolder } from "./tables";

const MAX_LINKS = 200;
const SEARCH_TEXT_LENGTH = 2000;

export const titleKeyOf = (title: string) => title.trim().toLowerCase().replaceAll(/\s+/g, " ");

const placeOf = async (ctx: MutationCtx, folder: Infer<typeof vNoteFolder> | undefined) => {
  if (folder?.table === "areas") {
    const areaId = ctx.db.normalizeId("areas", folder.id);
    const area = areaId ? await ctx.db.get("areas", areaId) : null;
    return area ? { areaId: area._id } : {};
  }
  if (folder?.table === "projects") {
    const projectId = ctx.db.normalizeId("projects", folder.id);
    const project = projectId ? await ctx.db.get("projects", projectId) : null;
    if (!project) return {};
    return { projectId: project._id, ...(project.areaId ? { areaId: project.areaId } : {}) };
  }
  return {};
};

const labelIdsOf = async (ctx: MutationCtx, names: string[]) => {
  if (names.length === 0) return [];
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const labels = await ctx.db.query("labels").take(500);
  return labels.filter((label) => wanted.has(label.name.toLowerCase())).map((label) => label._id);
};

const entityRefOf = async (ctx: MutationCtx, entity: Infer<typeof vNoteEntity>) => {
  const id = ctx.db.normalizeId(entity.table, entity.id);
  if (!id || !(await ctx.db.get(id))) return null;
  return { table: entity.table, id } as EntityRef;
};

const noteRefsOf = async (ctx: MutationCtx, self: Id<"notes">, titles: string[]) => {
  const refs: EntityRef[] = [];
  for (const title of titles) {
    const note = await ctx.db
      .query("notes")
      .withIndex("by_title_key", (q) => q.eq("titleKey", titleKeyOf(title)))
      .first();
    if (note && note._id !== self && note.trashedAt === undefined) refs.push({ table: "notes", id: note._id });
  }
  return refs;
};

const syncLinks = async (ctx: MutationCtx, note: Id<"notes">, wanted: EntityRef[]) => {
  const existing = await ctx.db
    .query("entityLinks")
    .withIndex("by_from", (q) => q.eq("from.id", note))
    .take(MAX_LINKS * 2);
  const wantedIds = new Set(wanted.map((ref) => ref.id as string));
  const kept = new Set<string>();
  for (const link of existing) {
    if (wantedIds.has(link.to.id) && !kept.has(link.to.id)) kept.add(link.to.id);
    else await ctx.db.delete("entityLinks", link._id);
  }
  for (const to of wanted) {
    if (!kept.has(to.id)) await ctx.db.insert("entityLinks", { from: { table: "notes", id: note }, to });
    kept.add(to.id);
  }
};

export const project = workerMutation({
  args: {
    docId: v.string(),
    title: v.string(),
    excerpt: v.string(),
    words: v.number(),
    folder: v.optional(vNoteFolder),
    day: v.optional(v.string()),
    labels: v.array(v.string()),
    entities: v.array(vNoteEntity),
    noteTitles: v.array(v.string()),
  },
  handler: async (ctx, args, worker) => {
    requireCapability(worker, "notes");
    const title = args.title.slice(0, 200);
    const excerpt = args.excerpt.slice(0, 400);
    const labelIds = await labelIdsOf(ctx, args.labels.slice(0, 50));
    const fields = {
      title,
      titleKey: titleKeyOf(title),
      excerpt,
      searchText: `${title}\n${excerpt}\n${args.labels.join(" ")}`.slice(0, SEARCH_TEXT_LENGTH),
      words: args.words,
      labelIds,
      updatedAt: Date.now(),
      ...(await placeOf(ctx, args.folder)),
      ...(args.day && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? { day: args.day } : {}),
    } satisfies Partial<Doc<"notes">>;
    const current = await ctx.db
      .query("notes")
      .withIndex("by_doc", (q) => q.eq("docId", args.docId))
      .unique();
    const noteId = current
      ? (await ctx.db.replace("notes", current._id, {
          docId: args.docId,
          ...fields,
          ...(current.trashedAt === undefined ? {} : { trashedAt: current.trashedAt }),
        }),
        current._id)
      : await ctx.db.insert("notes", { docId: args.docId, ...fields });
    const entityRefs = (await Promise.all(args.entities.slice(0, MAX_LINKS).map((e) => entityRefOf(ctx, e)))).filter(
      (ref): ref is EntityRef => ref !== null,
    );
    const noteRefs = await noteRefsOf(ctx, noteId, args.noteTitles.slice(0, MAX_LINKS));
    await syncLinks(ctx, noteId, [...entityRefs, ...noteRefs].slice(0, MAX_LINKS));
    return { noteId };
  },
});

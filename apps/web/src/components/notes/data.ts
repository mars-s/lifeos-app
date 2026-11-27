"use client";

import { useConvex, useQuery } from "convex/react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { SidebarView } from "@lifeos/backend/types";
import { projectNote, titleKey, type FolderRef } from "@lifeos/notes/markdown";
import type { ChipInfo, LinkOption } from "@lifeos/notes/editor";
import { localNotes, metaOf, subscribeIndex, textOf, type LocalNote } from "./library";

export type NoteItem = {
  docId: string;
  id?: Id<"notes">;
  title: string;
  excerpt: string;
  editedAt: number;
  areaId?: Id<"areas">;
  projectId?: Id<"projects">;
  day?: string;
};

const fromLocal = (note: LocalNote, sidebar: SidebarView | undefined) => {
  const projectArea =
    note.folder?.table === "projects" ? sidebar?.areas.find((area) => area.projects.some((p) => p._id === note.folder?.id)) : undefined;
  return {
    docId: note.docId,
    title: note.title,
    excerpt: note.excerpt,
    editedAt: note.editedAt,
    ...(note.folder?.table === "areas" ? { areaId: note.folder.id as Id<"areas"> } : {}),
    ...(note.folder?.table === "projects" ? { projectId: note.folder.id as Id<"projects"> } : {}),
    ...(projectArea ? { areaId: projectArea._id } : {}),
    ...(note.day ? { day: note.day } : {}),
  } satisfies NoteItem;
};

export const useLocalNotes = () => useSyncExternalStore(subscribeIndex, localNotes, () => []);

export const useNoteItems = (sidebar: SidebarView | undefined) => {
  const core = useQuery(api.notes.notes.list, {});
  const local = useLocalNotes();
  return useMemo(() => {
    const merged = new Map<string, NoteItem>();
    for (const row of core ?? []) {
      merged.set(row.docId, {
        docId: row.docId,
        id: row.id,
        title: row.title,
        excerpt: row.excerpt,
        editedAt: row.updatedAt,
        ...(row.areaId ? { areaId: row.areaId } : {}),
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.day ? { day: row.day } : {}),
      });
    }
    const trashed = new Set((core ?? []).filter((row) => row.trashedAt !== undefined).map((row) => row.docId));
    for (const note of local) {
      if (trashed.has(note.docId)) continue;
      const known = merged.get(note.docId);
      if (known && note.editedAt < known.editedAt) continue;
      merged.set(note.docId, { ...known, ...fromLocal(note, sidebar), ...(known?.id ? { id: known.id } : {}) });
    }
    return [...merged.values()].toSorted((a, b) => b.editedAt - a.editedAt);
  }, [core, local, sidebar]);
};

export const useNoteLookup = (items: NoteItem[]) =>
  useMemo(() => {
    const byTitle = new Map<string, NoteItem>();
    for (const item of items) if (!byTitle.has(titleKey(item.title))) byTitle.set(titleKey(item.title), item);
    return byTitle;
  }, [items]);

export const useSuggest = (items: NoteItem[], current: string | null) => {
  const convex = useConvex();
  return useCallback(
    async (query: string) => {
      const lower = query.trim().toLowerCase();
      const notes = items
        .filter((item) => item.docId !== current && !item.day && (lower === "" || item.title.toLowerCase().includes(lower)))
        .toSorted((a, b) => Number(b.title.toLowerCase().startsWith(lower)) - Number(a.title.toLowerCase().startsWith(lower)))
        .slice(0, 6)
        .map((item) => ({ kind: "note" as const, title: item.title }));
      const found = await convex.query(api.notes.notes.suggest, { query }).catch(() => null);
      const entities: LinkOption[] = found
        ? [
            ...found.tasks.map((t) => ({ kind: "entity" as const, table: "tasks" as const, id: t.id, title: t.title })),
            ...found.projects.map((p) => ({ kind: "entity" as const, table: "projects" as const, id: p.id, title: p.title })),
            ...found.areas.map((a) => ({ kind: "entity" as const, table: "areas" as const, id: a.id, title: a.title })),
          ]
        : [];
      return [...notes, ...entities] satisfies LinkOption[];
    },
    [convex, items, current],
  );
};

export const useDocText = (doc: Y.Doc | undefined) => {
  const text = doc ? textOf(doc) : null;
  return useSyncExternalStore(
    (listener) => {
      if (!text) return () => {};
      text.observe(listener);
      return () => text.unobserve(listener);
    },
    () => text?.toString() ?? "",
    () => "",
  );
};

export const useFolder = (doc: Y.Doc | undefined) => {
  const meta = doc ? metaOf(doc) : null;
  const raw = useSyncExternalStore(
    (listener) => {
      if (!meta) return () => {};
      meta.observe(listener);
      return () => meta.unobserve(listener);
    },
    () => JSON.stringify(meta?.get("folder") ?? null),
    () => "null",
  );
  return useMemo(() => JSON.parse(raw) as FolderRef | null, [raw]);
};

const EMPTY_CHIPS: ReadonlyMap<string, ChipInfo> = new Map();

export const useChips = (text: string) => {
  const ids = useMemo(() => projectNote(text).entities.map((entity) => entity.id).toSorted(), [text]);
  const key = ids.join(",");
  const stableIds = useMemo(() => (key ? key.split(",") : []), [key]);
  const found = useQuery(api.notes.notes.entities, stableIds.length > 0 ? { ids: stableIds } : "skip");
  const [chips, setChips] = useState<ReadonlyMap<string, ChipInfo>>(EMPTY_CHIPS);
  const [seen, setSeen] = useState(found);
  if (found && found !== seen) {
    setSeen(found);
    setChips(new Map(found.map((entity) => [entity.id, entity as ChipInfo])));
  }
  return chips;
};


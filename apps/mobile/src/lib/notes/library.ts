import { SQLiteStorage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { projectNote, type FolderRef } from "@lifeos/notes/markdown";
import { NOTE_META, NOTE_TEXT } from "@lifeos/notes/protocol";
import { remoteOrigin } from "@lifeos/notes/client";
import { appendUpdate, forgetIndexRow, loadIndex, loadUpdates, saveIndexRow, type LocalNote } from "./store";

const INDEX_DELAY_MS = 400;
const marksStore = new SQLiteStorage("lifeos-notes");
const TOUCHED_KEY = "touched";

const readTouched = () => {
  try {
    return JSON.parse(marksStore.getItemSync(TOUCHED_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
};

const touched = readTouched();

const touch = (docId: string) => {
  touched[docId] = Date.now();
  void marksStore.setItem(TOUCHED_KEY, JSON.stringify(touched));
};

export const editedSince = (since: number) => Object.keys(touched).filter((docId) => (touched[docId] ?? 0) > since);

export const readMarks = () => {
  try {
    const parsed = JSON.parse(marksStore.getItemSync("marks") ?? "null") as { core: number; local: number } | null;
    return parsed ?? { core: 0, local: 0 };
  } catch {
    return { core: 0, local: 0 };
  }
};

export const saveMarks = (marks: { core: number; local: number }) => void marksStore.setItem("marks", JSON.stringify(marks));
const loadOrigin = Symbol("load");

export const domOrigin = Symbol("dom");

type Open = { doc: Y.Doc; ready: Promise<void> };

const opened = new Map<string, Open>();
const listeners = new Set<() => void>();
let index: Record<string, LocalNote> = {};
let list: LocalNote[] = [];

const publish = () => {
  list = Object.values(index);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const empty: LocalNote[] = [];

export const useLocalNotes = () =>
  useSyncExternalStore(
    subscribe,
    () => list,
    () => empty,
  );

export const startLibrary = () =>
  loadIndex().then((rows) => {
    for (const row of rows) index[row.docId] ??= row;
    publish();
  });

export const dailyDocId = (date: string) => `day-${date}`;

export const newDocId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `n${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
};

export const metaOf = (doc: Y.Doc) => doc.getMap<unknown>(NOTE_META);
export const textOf = (doc: Y.Doc) => doc.getText(NOTE_TEXT);

export const folderOf = (doc: Y.Doc) => {
  const folder = metaOf(doc).get("folder");
  return folder && typeof folder === "object" && "table" in folder && "id" in folder ? (folder as FolderRef) : undefined;
};

export const remember = (docId: string, doc: Y.Doc) => {
  const text = textOf(doc).toString();
  const day = metaOf(doc).get("day");
  if (text.trim().length === 0 && typeof day !== "string") return;
  const { title, excerpt } = projectNote(typeof day === "string" ? `${day}\n${text}` : text);
  const folder = folderOf(doc);
  const note: LocalNote = {
    docId,
    title,
    excerpt,
    editedAt: Date.now(),
    ...(folder ? { folder } : {}),
    ...(typeof day === "string" ? { day } : {}),
  };
  index = { ...index, [docId]: note };
  publish();
  void saveIndexRow(note);
};

export const openNote = (docId: string) => {
  const known = opened.get(docId);
  if (known) return known;
  const doc = new Y.Doc();
  const ready = loadUpdates(docId).then((rows) => {
    doc.transact(() => {
      for (const row of rows) Y.applyUpdate(doc, row);
    }, loadOrigin);
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === loadOrigin) return;
    if (origin !== remoteOrigin) touch(docId);
    void appendUpdate(docId, update, () => Y.encodeStateAsUpdate(doc));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => remember(docId, doc), INDEX_DELAY_MS);
  });
  const entry = { doc, ready };
  opened.set(docId, entry);
  return entry;
};

export const ensureDaily = (doc: Y.Doc, date: string) => {
  if (metaOf(doc).get("day") === date) return;
  doc.transact(() => metaOf(doc).set("day", date));
};

export const setFolder = (doc: Y.Doc, folder: FolderRef | null) =>
  doc.transact(() => (folder ? metaOf(doc).set("folder", folder) : metaOf(doc).delete("folder")));

export const forgetLocal = (docId: string) => {
  const { [docId]: _gone, ...rest } = index;
  index = rest;
  publish();
  void forgetIndexRow(docId);
};

export const withNote = async (docId: string, use: (doc: Y.Doc) => Promise<void>) => {
  const known = opened.get(docId);
  if (known) {
    await known.ready;
    return use(known.doc);
  }
  const doc = new Y.Doc();
  const rows = await loadUpdates(docId);
  doc.transact(() => {
    for (const row of rows) Y.applyUpdate(doc, row);
  }, loadOrigin);
  const writes: Promise<unknown>[] = [];
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== loadOrigin) writes.push(appendUpdate(docId, update, () => Y.encodeStateAsUpdate(doc)));
  });
  try {
    await use(doc);
    if (writes.length > 0) remember(docId, doc);
    await Promise.all(writes);
  } finally {
    doc.destroy();
  }
};

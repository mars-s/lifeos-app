"use client";

import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { NOTE_META, NOTE_TEXT } from "@lifeos/notes/protocol";
import { projectNote, type FolderRef } from "@lifeos/notes/markdown";

const INDEX_KEY = "lifeos-notes-index";
const INDEX_DELAY_MS = 400;

export type LocalNote = {
  docId: string;
  title: string;
  excerpt: string;
  editedAt: number;
  folder?: FolderRef;
  day?: string;
};

type Open = { doc: Y.Doc; ready: Promise<void>; persistence: IndexeddbPersistence };

const opened = new Map<string, Open>();
const indexListeners = new Set<() => void>();

const readIndex = () => {
  try {
    const raw = globalThis.localStorage?.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LocalNote>) : {};
  } catch {
    return {};
  }
};

let index: Record<string, LocalNote> = typeof window === "undefined" ? {} : readIndex();
let indexList: LocalNote[] = Object.values(index);

const writeIndex = () => {
  indexList = Object.values(index);
  try {
    globalThis.localStorage?.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    return;
  }
  for (const listener of indexListeners) listener();
};

export const subscribeIndex = (listener: () => void) => {
  indexListeners.add(listener);
  return () => indexListeners.delete(listener);
};

export const localNotes = () => indexList;

export const forgetLocal = (docId: string) => {
  delete index[docId];
  writeIndex();
};

export const dailyDocId = (date: string) => `day-${date}`;

export const newDocId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `n${[...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
};

export const metaOf = (doc: Y.Doc) => doc.getMap<unknown>(NOTE_META);
export const textOf = (doc: Y.Doc) => doc.getText(NOTE_TEXT);

const folderOf = (doc: Y.Doc) => {
  const folder = metaOf(doc).get("folder");
  return folder && typeof folder === "object" && "table" in folder && "id" in folder ? (folder as FolderRef) : undefined;
};

const remember = (docId: string, doc: Y.Doc) => {
  const text = textOf(doc).toString();
  const day = metaOf(doc).get("day");
  if (text.trim().length === 0 && typeof day !== "string") return;
  const { title, excerpt } = projectNote(typeof day === "string" ? `${day}\n${text}` : text);
  const folder = folderOf(doc);
  index = {
    ...index,
    [docId]: {
      docId,
      title,
      excerpt,
      editedAt: Date.now(),
      ...(folder ? { folder } : {}),
      ...(typeof day === "string" ? { day } : {}),
    },
  };
  writeIndex();
};

export const openNote = (docId: string) => {
  const known = opened.get(docId);
  if (known) return known;
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`lifeos-note-${docId}`, doc);
  const ready = persistence.whenSynced.then(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  doc.on("update", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => remember(docId, doc), INDEX_DELAY_MS);
  });
  const entry = { doc, ready, persistence };
  opened.set(docId, entry);
  return entry;
};

export const ensureDaily = (doc: Y.Doc, date: string) => {
  if (metaOf(doc).get("day") === date) return;
  doc.transact(() => metaOf(doc).set("day", date));
};

export const setFolder = (doc: Y.Doc, folder: FolderRef | null) =>
  doc.transact(() => (folder ? metaOf(doc).set("folder", folder) : metaOf(doc).delete("folder")));

export const knownDocIds = () => Object.keys(index);

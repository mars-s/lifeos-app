import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { FolderRef } from "@lifeos/notes/markdown";

export const COMPACT_AFTER = 200;

export type LocalNote = {
  docId: string;
  title: string;
  excerpt: string;
  editedAt: number;
  folder?: FolderRef;
  day?: string;
};

type NoteRow = {
  doc_id: string;
  title: string;
  excerpt: string;
  edited_at: number;
  folder_table: string | null;
  folder_id: string | null;
  day: string | null;
};

let opened: Promise<SQLiteDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const database = () => {
  opened ??= openDatabaseAsync("lifeos-notes").then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, doc_id TEXT NOT NULL, data BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS updates_by_doc ON updates (doc_id, id);
      CREATE TABLE IF NOT EXISTS notes (
        doc_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        folder_table TEXT,
        folder_id TEXT,
        day TEXT
      );
    `);
    return db;
  });
  return opened;
};

const inOrder = <T,>(work: (db: SQLiteDatabase) => Promise<T>) => {
  const next = queue.then(async () => work(await database()));
  queue = next.catch(() => undefined);
  return next;
};

export const loadUpdates = (docId: string) =>
  inOrder(async (db) => {
    const rows = await db.getAllAsync<{ data: Uint8Array }>("SELECT data FROM updates WHERE doc_id = ? ORDER BY id", docId);
    return rows.map((row) => row.data);
  });

export const appendUpdate = (docId: string, update: Uint8Array, snapshot: () => Uint8Array) =>
  inOrder(async (db) => {
    await db.runAsync("INSERT INTO updates (doc_id, data) VALUES (?, ?)", docId, update);
    const count = await db.getFirstAsync<{ rows: number }>("SELECT COUNT(*) AS rows FROM updates WHERE doc_id = ?", docId);
    if ((count?.rows ?? 0) <= COMPACT_AFTER) return;
    const whole = snapshot();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM updates WHERE doc_id = ?", docId);
      await db.runAsync("INSERT INTO updates (doc_id, data) VALUES (?, ?)", docId, whole);
    });
  });

export const loadIndex = () =>
  inOrder(async (db) => {
    const rows = await db.getAllAsync<NoteRow>("SELECT * FROM notes");
    return rows.map(
      (row) =>
        ({
          docId: row.doc_id,
          title: row.title,
          excerpt: row.excerpt,
          editedAt: row.edited_at,
          ...(row.folder_table && row.folder_id ? { folder: { table: row.folder_table, id: row.folder_id } as FolderRef } : {}),
          ...(row.day ? { day: row.day } : {}),
        }) satisfies LocalNote,
    );
  });

export const saveIndexRow = (note: LocalNote) =>
  inOrder((db) =>
    db.runAsync(
      "INSERT OR REPLACE INTO notes (doc_id, title, excerpt, edited_at, folder_table, folder_id, day) VALUES (?, ?, ?, ?, ?, ?, ?)",
      note.docId,
      note.title,
      note.excerpt,
      note.editedAt,
      note.folder?.table ?? null,
      note.folder?.id ?? null,
      note.day ?? null,
    ),
  );

export const forgetIndexRow = (docId: string) => inOrder((db) => db.runAsync("DELETE FROM notes WHERE doc_id = ?", docId));

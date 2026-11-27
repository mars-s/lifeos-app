import type * as Y from "yjs";
import { NOTE_META, NOTE_TEXT } from "@lifeos/notes/protocol";
import { projectNote, type FolderRef } from "@lifeos/notes/markdown";

const isFolder = (value: unknown): value is FolderRef =>
  typeof value === "object" &&
  value !== null &&
  "table" in value &&
  "id" in value &&
  (value.table === "areas" || value.table === "projects") &&
  typeof value.id === "string";

export const projectionOf = (docId: string, doc: Y.Doc) => {
  const meta = doc.getMap<unknown>(NOTE_META);
  const folder = meta.get("folder");
  const day = meta.get("day");
  const { title, excerpt, words, entities, noteTitles, labels } = projectNote(doc.getText(NOTE_TEXT).toString());
  return {
    docId,
    title,
    excerpt,
    words,
    labels,
    noteTitles,
    entities: entities.map(({ table, id }) => ({ table, id })),
    ...(isFolder(folder) ? { folder: { table: folder.table, id: folder.id } } : {}),
    ...(typeof day === "string" ? { day } : {}),
  };
};

export const sendProjection = async (convexUrl: string, token: string, projection: ReturnType<typeof projectionOf>) => {
  const response = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "notes/relay:project", args: { token, ...projection }, format: "json" }),
  });
  const body: unknown = await response.json().catch(() => null);
  const failed = !response.ok || (typeof body === "object" && body !== null && "status" in body && body.status !== "success");
  if (failed) throw new Error(`Core refused the projection: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
};

import type * as Y from "yjs";
import { catchUp } from "./client";

export type SyncMarks = { readonly core: number; readonly local: number };

export type CatchUpSource = {
  readonly marks: SyncMarks;
  readonly changedInCore: (since: number) => Promise<readonly { docId: string; updatedAt: number }[]>;
  readonly editedHere: (since: number) => readonly string[];
  readonly withDoc: (docId: string, use: (doc: Y.Doc) => Promise<void>) => Promise<void>;
  readonly token: string;
  readonly relayUrl?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
};

const PARALLEL = 4;
export const CHANGED_PAGE = 500;

export const catchUpAll = async (source: CatchUpSource) => {
  const started = (source.now ?? Date.now)();
  const changed = await source.changedInCore(source.marks.core);
  const wanted = [...new Set([...changed.map((note) => note.docId), ...source.editedHere(source.marks.local)])];
  const failed: string[] = [];
  for (let at = 0; at < wanted.length; at += PARALLEL) {
    await Promise.all(
      wanted.slice(at, at + PARALLEL).map((docId) =>
        source
          .withDoc(docId, (doc) =>
            catchUp({
              doc,
              docId,
              token: source.token,
              ...(source.relayUrl ? { relayUrl: source.relayUrl } : {}),
              ...(source.fetch ? { fetch: source.fetch } : {}),
            }).then(() => undefined),
          )
          .catch(() => {
            failed.push(docId);
          }),
      ),
    );
  }
  const core = failed.length > 0 ? source.marks.core : changed.reduce((newest, note) => Math.max(newest, note.updatedAt), source.marks.core);
  const local = failed.length > 0 ? source.marks.local : started;
  return { marks: { core, local } satisfies SyncMarks, synced: wanted.length - failed.length, failed, more: failed.length === 0 && changed.length >= CHANGED_PAGE };
};

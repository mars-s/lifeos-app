"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { isTauri } from "@tauri-apps/api/core";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { NoteSync, RELAY_URL, type SyncStatus } from "@lifeos/notes/client";
import { registry } from "../../lib/atoms";
import { openNote } from "./library";

export const relayUrl = import.meta.env.WAKU_PUBLIC_NOTES_RELAY_URL ?? RELAY_URL;

const tokenStore = { current: null as string | null };

export const useRelayToken = () => {
  const token = useAuthToken();
  useEffect(() => {
    tokenStore.current = token;
  }, [token]);
  return token;
};

export const relayToken = () => Promise.resolve(tokenStore.current);

type Live = { sync: NoteSync; users: number };
type Awareness = NoteSync["awareness"];
const live = new Map<string, Live>();
const awarenessAtom = Atom.make<ReadonlyMap<string, Awareness>>(new Map()).pipe(Atom.keepAlive);
const liveChanged = () => registry.set(awarenessAtom, new Map([...live].map(([docId, entry]) => [docId, entry.sync.awareness])));
const overallAtom = Atom.make<SyncStatus>({ kind: "connecting" }).pipe(Atom.keepAlive);

const recompute = () => {
  const statuses = [...live.values()].map((entry) => entry.sync.status);
  const merging = statuses.find((s) => s.kind === "merging");
  const offline = statuses.filter((s): s is Extract<SyncStatus, { kind: "offline" }> => s.kind === "offline");
  const next: SyncStatus = merging
    ? merging
    : offline.length > 0
      ? { kind: "offline", waiting: offline.reduce((sum, s) => sum + s.waiting, 0) }
      : statuses.some((s) => s.kind === "connecting")
        ? { kind: "connecting" }
        : { kind: "synced" };
  if (JSON.stringify(next) === JSON.stringify(registry.get(overallAtom))) return;
  registry.set(overallAtom, next);
};

export const useNotesStatus = () => useAtomValue(overallAtom);

const acquire = (docId: string, doc: Y.Doc) => {
  const known = live.get(docId);
  if (known) {
    known.users++;
    return known.sync;
  }
  const sync = new NoteSync(doc, docId, { token: relayToken, relayUrl, name: isTauri() ? "Mac" : "Web" });
  sync.subscribe(recompute);
  live.set(docId, { sync, users: 1 });
  liveChanged();
  void sync.start();
  return sync;
};

const release = (docId: string) => {
  const known = live.get(docId);
  if (!known) return;
  known.users--;
  if (known.users > 0) return;
  setTimeout(() => {
    if ((live.get(docId)?.users ?? 0) > 0) return;
    known.sync.stop();
    live.delete(docId);
    liveChanged();
    recompute();
  }, 2000);
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const entry of live.values()) entry.sync.reconnectNow();
  });
  window.addEventListener("offline", () => {
    for (const entry of live.values()) entry.sync.disconnect();
  });
}

export const useNote = (docId: string | null) => {
  const entry = useMemo(() => (docId ? openNote(docId) : null), [docId]);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "connecting" });
  const awareness = useAtomValue(
    awarenessAtom,
    useCallback((all: ReadonlyMap<string, Awareness>) => (docId ? (all.get(docId) ?? null) : null), [docId]),
  );
  const token = useRelayToken();
  const syncRef = useRef<NoteSync | null>(null);

  useEffect(() => {
    if (!docId || !entry) return;
    let alive = true;
    void entry.ready.then(() => alive && setReadyFor(docId));
    const sync = acquire(docId, entry.doc);
    syncRef.current = sync;
    const stop = sync.subscribe((next) => setStatus(next));
    return () => {
      alive = false;
      stop();
      syncRef.current = null;
      release(docId);
    };
  }, [docId, entry]);

  useEffect(() => {
    if (token) syncRef.current?.reconnectNow();
  }, [token]);

  return entry && docId ? { docId, doc: entry.doc, awareness, ready: readyFor === docId, status } : null;
};

import { useAuthToken } from "@convex-dev/auth/react";
import { addNetworkStateListener } from "expo-network";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type * as Y from "yjs";
import { NoteSync, RELAY_URL, type SyncStatus } from "@lifeos/notes/client";
import { openNote } from "./library";

const relayUrl = process.env.EXPO_PUBLIC_NOTES_RELAY_URL || RELAY_URL;
const RELEASE_AFTER_MS = 2000;

const tokenStore = { current: null as string | null };
const relayToken = () => Promise.resolve(tokenStore.current);

type Live = { sync: NoteSync; users: number };
const live = new Map<string, Live>();
const liveListeners = new Set<() => void>();
const liveChanged = () => {
  for (const listener of liveListeners) listener();
};
const subscribeLive = (listener: () => void) => {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
};

const acquire = (docId: string, doc: Y.Doc) => {
  const known = live.get(docId);
  if (known) {
    known.users++;
    return known.sync;
  }
  const sync = new NoteSync(doc, docId, { token: relayToken, relayUrl });
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
  }, RELEASE_AFTER_MS);
};

AppState.addEventListener("change", (state) => {
  if (state !== "active") return;
  for (const entry of live.values()) entry.sync.reconnectNow();
});

addNetworkStateListener((state) => {
  for (const entry of live.values()) {
    if (state.isConnected === false) entry.sync.disconnect();
    else entry.sync.reconnectNow();
  }
});

export const useNote = (docId: string | null) => {
  const entry = useMemo(() => (docId ? openNote(docId) : null), [docId]);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ kind: "connecting" });
  const sync = useSyncExternalStore(
    subscribeLive,
    () => (docId ? (live.get(docId)?.sync ?? null) : null),
    () => null,
  );
  const token = useAuthToken();
  const syncRef = useRef<NoteSync | null>(null);

  useLayoutEffect(() => {
    tokenStore.current = token;
  }, [token]);

  useEffect(() => {
    if (!docId || !entry) return;
    let alive = true;
    void entry.ready.then(() => alive && setReadyFor(docId));
    const acquired = acquire(docId, entry.doc);
    syncRef.current = acquired;
    const stop = acquired.subscribe((next) => setStatus(next));
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

  return entry && docId ? { docId, doc: entry.doc, sync, ready: readyFor === docId, status } : null;
};

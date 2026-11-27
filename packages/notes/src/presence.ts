import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type * as Y from "yjs";

export type { Awareness };

export type PresenceChange = { added: number[]; updated: number[]; removed: number[] };

export type PeerSnapshot = { readonly update: Uint8Array; readonly ids: readonly number[] };

export const forgetDeparted = (awareness: Awareness, keep: (clientID: number) => boolean) => {
  const listener = ({ removed }: PresenceChange) => {
    for (const clientID of removed) if (!keep(clientID)) awareness.meta.delete(clientID);
  };
  awareness.on("change", listener);
  return () => awareness.off("change", listener);
};

export const devicePresence = (doc: Y.Doc, name: string) => {
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", { name });
  forgetDeparted(awareness, (clientID) => clientID === awareness.clientID);
  return awareness;
};

export const ownPresence = (awareness: Awareness) => encodeAwarenessUpdate(awareness, [awareness.clientID]);

export const peerSnapshot = (awareness: Awareness, ids: readonly number[]) =>
  ({ update: encodeAwarenessUpdate(awareness, [...ids]), ids }) satisfies PeerSnapshot;

export const mirrorPeers = (awareness: Awareness, snapshot: PeerSnapshot, origin: unknown) => {
  if (snapshot.ids.length > 0) applyAwarenessUpdate(awareness, snapshot.update, origin);
  const keep = new Set(snapshot.ids);
  const gone = [...awareness.states.keys()].filter((clientID) => clientID !== awareness.clientID && !keep.has(clientID));
  removeAwarenessStates(awareness, gone, origin);
};

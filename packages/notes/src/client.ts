import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as Y from "yjs";
import {
  MessageKind,
  NOTES_PROTOCOL,
  answerSync,
  decodeCatchUpReply,
  encodeCatchUpRequest,
  encodePresence,
  presenceFrame,
  readKind,
  readPresence,
  syncStep1,
  syncUpdate,
  type PresenceEntry,
} from "./protocol";
import { forgetDeparted, peerSnapshot, type PresenceChange } from "./presence";

export const RELAY_URL = "https://lifeos-relay.zephyrus.qzz.io";
export const SEND_MS = 30;
const BACKED_UP_BYTES = 64 * 1024;
const MERGING_MS = 700;
const MAX_BACKOFF_MS = 30_000;

export type SyncStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "synced" }
  | { readonly kind: "offline"; readonly waiting: number }
  | { readonly kind: "merging"; readonly edits: number };

export type TokenSource = () => Promise<string | null>;

type SocketLike = {
  binaryType: string;
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: "open" | "close" | "error" | "message", listener: (event: { data?: unknown }) => void) => void;
};

type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export const remoteOrigin = Symbol("relay");
export const bridgedOrigin = Symbol("bridged");


const toBytes = (data: unknown) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
};

const wsUrl = (relayUrl: string, docId: string) => `${relayUrl.replace(/^http/, "ws")}/notes/${docId}`;

export class NoteSync {
  readonly awareness: Awareness;
  private readonly own = new Set<number>();
  private presence = new Map<number, PresenceEntry>();
  private announcing = false;
  private readonly unforget: () => void;
  private socket: SocketLike | null = null;
  private pending: Uint8Array[] = [];
  private waiting = 0;
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private mergingUntil = 0;
  private mergingTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteEdits = 0;
  private backoff = 1000;
  private stopped = false;
  private caughtUp = false;
  private current: SyncStatus = { kind: "connecting" };
  private readonly listeners = new Set<(status: SyncStatus) => void>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly docId: string,
    private readonly options: { token: TokenSource; relayUrl?: string; socket?: SocketFactory; name?: string },
  ) {
    this.awareness = new Awareness(doc);
    if (options.name) this.awareness.setLocalStateField("user", { name: options.name });
    else this.awareness.setLocalState(null);
    this.own.add(doc.clientID);
    this.unforget = forgetDeparted(this.awareness, (clientID) => this.own.has(clientID));
    this.awareness.on("update", this.onPresence);
    doc.on("update", this.onUpdate);
  }

  sharePresence(update: Uint8Array) {
    applyAwarenessUpdate(this.awareness, update, bridgedOrigin);
  }

  forgetShared() {
    const shared = [...this.own].filter((clientID) => clientID !== this.doc.clientID);
    removeAwarenessStates(this.awareness, shared, bridgedOrigin);
  }

  private readonly onPresence = ({ added, updated, removed }: PresenceChange, origin: unknown) => {
    if (origin === remoteOrigin) {
      if (added.some((clientID) => !this.own.has(clientID))) this.announce();
      return;
    }
    if (origin === "timeout") return;
    if (origin === bridgedOrigin) for (const clientID of [...added, ...updated]) this.own.add(clientID);
    for (const clientID of [...added, ...updated, ...removed]) if (this.own.has(clientID)) this.queuePresence(clientID);
    if (origin === bridgedOrigin) for (const clientID of removed) this.own.delete(clientID);
    if (this.presence.size > 0) this.schedule();
  };

  private queuePresence(clientID: number) {
    const state = this.awareness.states.get(clientID) ?? null;
    this.presence.set(clientID, { clientID, clock: this.awareness.meta.get(clientID)?.clock ?? 0, state: JSON.stringify(state) });
  }

  private announce() {
    for (const clientID of this.own) if (this.awareness.states.has(clientID)) this.queuePresence(clientID);
    if (this.presence.size === 0) return;
    this.announcing = true;
    this.schedule();
  }

  peers() {
    return peerSnapshot(this.awareness, [...this.awareness.states.keys()].filter((clientID) => !this.own.has(clientID)));
  }

  private hasPeers() {
    for (const clientID of this.awareness.states.keys()) if (!this.own.has(clientID)) return true;
    return false;
  }

  private forgetPeers() {
    const peers = [...this.awareness.states.keys()].filter((clientID) => !this.own.has(clientID));
    removeAwarenessStates(this.awareness, peers, remoteOrigin);
  }

  get status() {
    return this.current;
  }

  subscribe(listener: (status: SyncStatus) => void) {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  private set(status: SyncStatus) {
    this.current = status;
    for (const listener of this.listeners) listener(status);
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === remoteOrigin) {
      this.remoteEdits++;
      this.mergingUntil = Date.now() + MERGING_MS;
      if (this.caughtUp) this.set({ kind: "merging", edits: this.remoteEdits });
      if (this.mergingTimer) clearTimeout(this.mergingTimer);
      this.mergingTimer = setTimeout(() => {
        this.remoteEdits = 0;
        if (this.isOpen() && this.caughtUp) this.set({ kind: "synced" });
      }, MERGING_MS);
      return;
    }
    if (!this.isOpen()) {
      this.waiting++;
      if (this.current.kind === "offline") this.set({ kind: "offline", waiting: this.waiting });
      return;
    }
    this.pending.push(update);
    this.schedule();
  };

  private isOpen() {
    return this.socket !== null && this.socket.readyState === 1;
  }

  private schedule() {
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + SEND_MS - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    if (!socket || !this.isOpen()) return;
    if (this.pending.length > 1) this.pending = [Y.mergeUpdates(this.pending)];
    if ((socket.bufferedAmount ?? 0) > BACKED_UP_BYTES) {
      this.lastSent = Date.now();
      this.schedule();
      return;
    }
    const update = this.pending[0];
    this.pending = [];
    this.lastSent = Date.now();
    if (update) socket.send(syncUpdate(update));
    if (this.presence.size === 0) return;
    if (this.announcing || this.hasPeers()) socket.send(presenceFrame(encodePresence([...this.presence.values()])));
    this.presence.clear();
    this.announcing = false;
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    const token = await this.options.token().catch(() => null);
    if (this.stopped) return;
    if (!token) return this.goOffline();
    const make: SocketFactory =
      this.options.socket ?? ((url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike);
    const socket = make(wsUrl(this.options.relayUrl ?? RELAY_URL, this.docId), [NOTES_PROTOCOL, token]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.caughtUp = false;
    socket.addEventListener("open", () => {
      this.backoff = 1000;
      socket.send(syncStep1(this.doc));
      this.announce();
    });
    socket.addEventListener("message", (event) => {
      const bytes = toBytes(event.data);
      if (!bytes) return;
      if (readKind(bytes) === MessageKind.awareness) {
        const update = readPresence(bytes);
        if (update) {
          try {
            applyAwarenessUpdate(this.awareness, update, remoteOrigin);
          } catch {
            return;
          }
        }
        return;
      }
      const { reply } = answerSync(this.doc, bytes, remoteOrigin);
      if (reply && socket.readyState === 1) socket.send(reply);
      if (!this.caughtUp && bytes[1] === 1) {
        this.caughtUp = true;
        this.waiting = 0;
        this.schedule();
        if (Date.now() >= this.mergingUntil) this.set({ kind: "synced" });
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.waiting += this.pending.length;
      this.pending = [];
      this.presence.clear();
      this.announcing = false;
      this.forgetPeers();
      this.goOffline();
    });
    socket.addEventListener("error", () => socket.close());
  }

  private goOffline() {
    this.caughtUp = false;
    this.set({ kind: "offline", waiting: this.waiting });
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "offline");
    if (!this.stopped) this.goOffline();
  }

  reconnectNow() {
    if (this.isOpen() || this.stopped) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.backoff = 1000;
    this.socket?.close();
    void this.connect();
  }

  stop() {
    this.stopped = true;
    removeAwarenessStates(this.awareness, [...this.own], "local");
    this.flush();
    if (this.retry) clearTimeout(this.retry);
    if (this.mergingTimer) clearTimeout(this.mergingTimer);
    this.retry = null;
    this.doc.off("update", this.onUpdate);
    this.awareness.off("update", this.onPresence);
    this.unforget();
    this.awareness.destroy();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "closed");
  }
}

export const catchUp = async (options: {
  doc: Y.Doc;
  docId: string;
  token: string;
  relayUrl?: string;
  fetch?: typeof fetch;
}) => {
  const send = options.fetch ?? fetch;
  const body = encodeCatchUpRequest({
    stateVector: Y.encodeStateVector(options.doc),
    update: Y.encodeStateAsUpdate(options.doc),
  });
  const response = await send(`${options.relayUrl ?? RELAY_URL}/notes/${options.docId}/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/octet-stream" },
    body,
  });
  if (!response.ok) throw new Error(`The relay answered ${response.status}`);
  const reply = decodeCatchUpReply(new Uint8Array(await response.arrayBuffer()));
  if (reply.update.byteLength > 2) Y.applyUpdate(options.doc, reply.update, remoteOrigin);
  return reply;
};

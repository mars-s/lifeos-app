import * as Y from "yjs";
import {
  MessageKind,
  NOTES_PROTOCOL,
  answerSync,
  decodeCatchUpReply,
  encodeCatchUpRequest,
  readKind,
  syncStep1,
  syncUpdate,
} from "./protocol";

export const RELAY_URL = "https://lifeos-relay.zephyrus.qzz.io";
export const BATCH_MS = 500;
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
  send: (data: Uint8Array) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: "open" | "close" | "error" | "message", listener: (event: { data?: unknown }) => void) => void;
};

type SocketFactory = (url: string, protocols: string[]) => SocketLike;

export const remoteOrigin = Symbol("relay");

const toBytes = (data: unknown) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
};

const wsUrl = (relayUrl: string, docId: string) => `${relayUrl.replace(/^http/, "ws")}/notes/${docId}`;

export class NoteSync {
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
    private readonly options: { token: TokenSource; relayUrl?: string; socket?: SocketFactory },
  ) {
    doc.on("update", this.onUpdate);
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
    const wait = Math.max(0, this.lastSent + BATCH_MS - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.isOpen() || this.pending.length === 0) return;
    const merged = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.lastSent = Date.now();
    this.socket?.send(syncUpdate(merged));
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
    });
    socket.addEventListener("message", (event) => {
      const bytes = toBytes(event.data);
      if (!bytes) return;
      if (readKind(bytes) === MessageKind.awareness) return;
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
    this.flush();
    if (this.retry) clearTimeout(this.retry);
    if (this.mergingTimer) clearTimeout(this.mergingTimer);
    this.retry = null;
    this.doc.off("update", this.onUpdate);
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

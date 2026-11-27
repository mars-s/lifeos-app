import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import {
  NOTES_PROTOCOL,
  NOTE_TEXT,
  answerSync,
  decodePresence,
  encodeCatchUpReply,
  encodePresence,
  presenceFrame,
  readPresence,
  syncStep1,
  syncUpdate,
} from "@lifeos/notes/protocol";
import type { Env } from "./env.ts";
import { projectionOf, sendProjection } from "./projection.ts";

export const COMPACT_AFTER_ROWS = 200;
export const QUIET_MS = 10_000;
export const SAVE_MS = 1000;
const MAX_PRESENT = 16;

type Present = Record<string, number>;

const fromStorage = Symbol("storage");

export class Note extends DurableObject<Env> {
  private doc = new Y.Doc({ gc: true });
  private rows = 0;
  private lastEdit = 0;
  private alarmSet = false;
  private unsaved: Uint8Array[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => this.load());
  }

  private load() {
    this.doc = new Y.Doc({ gc: true });
    this.rows = 0;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY, data BLOB NOT NULL)");
    for (const row of this.ctx.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM updates ORDER BY id")) {
      Y.applyUpdate(this.doc, new Uint8Array(row.data), fromStorage);
      this.rows++;
    }
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === fromStorage) return;
      this.unsaved.push(update);
      this.saveSoon();
      this.broadcast(syncUpdate(update), origin);
      this.noteEdit();
    });
  }

  private get quietMs() {
    const configured = Number(this.env.QUIET_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : QUIET_MS;
  }

  private get saveMs() {
    const configured = Number(this.env.SAVE_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : SAVE_MS;
  }

  private saveSoon() {
    this.saveTimer ??= setTimeout(() => this.save(), this.saveMs);
  }

  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.unsaved.length === 0) return;
    const merged = this.unsaved.length === 1 ? this.unsaved[0]! : Y.mergeUpdates(this.unsaved);
    this.unsaved = [];
    this.persist(merged);
  }

  private noteEdit() {
    this.lastEdit = Date.now();
    if (this.alarmSet) return;
    this.alarmSet = true;
    void this.ctx.storage.setAlarm(this.lastEdit + this.quietMs);
  }

  override async alarm() {
    const quietFor = Date.now() - this.lastEdit;
    if (this.lastEdit > 0 && quietFor < this.quietMs) {
      await this.ctx.storage.setAlarm(this.lastEdit + this.quietMs);
      return;
    }
    this.alarmSet = false;
    const docId = this.ctx.id.name;
    const token = this.env.CORE_WORKER_TOKEN;
    if (!docId || !token) return;
    await sendProjection(this.env.CONVEX_CLOUD_URL, token, projectionOf(docId, this.doc));
  }

  projection() {
    return this.ctx.id.name ? projectionOf(this.ctx.id.name, this.doc) : null;
  }

  private persist(update: Uint8Array) {
    if (this.rows + 1 < COMPACT_AFTER_ROWS) {
      this.ctx.storage.sql.exec("INSERT INTO updates (data) VALUES (?)", update);
      this.rows++;
      return;
    }
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM updates");
      this.ctx.storage.sql.exec("INSERT INTO updates (data) VALUES (?)", snapshot);
    });
    this.rows = 1;
  }

  private broadcast(message: Uint8Array, except: unknown) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(message);
      } catch {
        socket.close(1011, "send failed");
      }
    }
  }

  override async fetch() {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(syncStep1(this.doc));
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": NOTES_PROTOCOL } });
  }

  override async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return;
    const bytes = new Uint8Array(message);
    const presence = readPresence(bytes);
    if (presence) {
      this.track(socket, presence);
      this.broadcast(bytes, socket);
      return;
    }
    const { reply } = answerSync(this.doc, bytes, socket);
    if (reply) socket.send(reply);
  }

  private track(socket: WebSocket, update: Uint8Array) {
    const present: Present = { ...(socket.deserializeAttachment() as Present | null) };
    try {
      for (const entry of decodePresence(update)) {
        if (entry.state === "null") delete present[entry.clientID];
        else present[entry.clientID] = entry.clock;
      }
    } catch {
      return;
    }
    if (Object.keys(present).length <= MAX_PRESENT) socket.serializeAttachment(present);
  }

  private depart(socket: WebSocket) {
    const present = (socket.deserializeAttachment() as Present | null) ?? {};
    const entries = Object.entries(present).map(([clientID, clock]) => ({ clientID: Number(clientID), clock, state: "null" }));
    socket.serializeAttachment(null);
    if (entries.length > 0) this.broadcast(presenceFrame(encodePresence(entries)), socket);
  }

  override async webSocketError(socket: WebSocket) {
    this.save();
    this.depart(socket);
  }

  override async webSocketClose(socket: WebSocket, code: number) {
    this.save();
    this.depart(socket);
    try {
      socket.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      return;
    }
  }

  catchUp(stateVector: Uint8Array, update: Uint8Array) {
    if (update.byteLength > 0) Y.applyUpdate(this.doc, update, "catch-up");
    return encodeCatchUpReply({
      update: Y.encodeStateAsUpdate(this.doc, stateVector),
      stateVector: Y.encodeStateVector(this.doc),
    });
  }

  async erase() {
    for (const socket of this.ctx.getWebSockets()) socket.close(4404, "note deleted");
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.unsaved = [];
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.alarmSet = false;
    this.doc.destroy();
    this.load();
  }

  inspect() {
    return { text: this.doc.getText(NOTE_TEXT).toString(), rows: this.rows, unsaved: this.unsaved.length, sockets: this.ctx.getWebSockets().length };
  }
}

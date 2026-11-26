import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import {
  MessageKind,
  NOTES_PROTOCOL,
  NOTE_TEXT,
  answerSync,
  encodeCatchUpReply,
  readKind,
  syncStep1,
  syncUpdate,
} from "@lifeos/notes/protocol";
import type { Env } from "./env.ts";

export const COMPACT_AFTER_ROWS = 200;

const fromStorage = Symbol("storage");

export class Note extends DurableObject<Env> {
  private doc = new Y.Doc({ gc: true });
  private rows = 0;

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
      this.persist(update);
      this.broadcast(syncUpdate(update), origin);
    });
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
    if (readKind(bytes) === MessageKind.awareness) {
      this.broadcast(bytes, socket);
      return;
    }
    const { reply } = answerSync(this.doc, bytes, socket);
    if (reply) socket.send(reply);
  }

  override async webSocketClose(socket: WebSocket, code: number) {
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
    await this.ctx.storage.deleteAll();
    this.doc.destroy();
    this.load();
  }

  inspect() {
    return { text: this.doc.getText(NOTE_TEXT).toString(), rows: this.rows, sockets: this.ctx.getWebSockets().length };
  }
}

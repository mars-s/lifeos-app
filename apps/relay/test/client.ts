import { SELF, env } from "cloudflare:test";
import { SignJWT, importJWK } from "jose";
import * as Y from "yjs";
import { NOTES_PROTOCOL, NOTE_TEXT, answerSync, syncStep1, syncUpdate } from "@lifeos/notes/protocol";

export const BASE = "https://relay.test/notes/";

type Mint = { aud?: string; iss?: string; exp?: number | string; key?: CryptoKey };

export const mint = async (options: Mint = {}) => {
  const key = options.key ?? ((await importJWK(JSON.parse(env.TEST_PRIVATE_JWK), "ES256")) as CryptoKey);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setSubject("session-test")
    .setAudience(options.aud ?? "convex-auth")
    .setIssuer(options.iss ?? `${env.CONVEX_CLOUD_URL}/components/auth`)
    .setIssuedAt()
    .setExpirationTime(options.exp ?? "60s")
    .sign(key);
};

export const upgrade = (noteId: string, protocols: string[]) =>
  SELF.fetch(`${BASE}${noteId}`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": protocols.join(", ") },
  });

export const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

export class TestPeer {
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText(NOTE_TEXT);
  private socket: WebSocket | null = null;

  constructor(
    private readonly noteId: string,
    private readonly token: string,
  ) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || !this.socket) return;
      this.socket.send(syncUpdate(update));
    });
  }

  async connect() {
    const response = await upgrade(this.noteId, [NOTES_PROTOCOL, this.token]);
    const socket = response.webSocket;
    if (!socket) throw new Error(`refused with ${response.status}`);
    socket.binaryType = "arraybuffer";
    socket.accept();
    socket.addEventListener("message", (event) => {
      const data = event.data;
      if (typeof data === "string") return;
      const { reply } = answerSync(this.doc, new Uint8Array(data), "remote");
      if (reply && socket.readyState === WebSocket.OPEN) socket.send(reply);
    });
    socket.send(syncStep1(this.doc));
    this.socket = socket;
    return response.headers.get("Sec-WebSocket-Protocol");
  }

  disconnect() {
    this.socket?.close(1000, "bye");
    this.socket = null;
  }

  type(value: string, at = this.text.length) {
    let position = at;
    for (const character of value) this.text.insert(position++, character);
  }

  value() {
    return this.text.toString();
  }
}

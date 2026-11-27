import { SELF, env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { NOTES_PROTOCOL, NOTE_META, NOTE_TEXT, decodeCatchUpReply, encodeCatchUpRequest } from "@lifeos/notes/protocol";
import { COMPACT_AFTER_ROWS, type Note } from "../src/note.ts";
import { BASE, TestPeer, mint, settle, upgrade } from "./client.ts";

const stub = (noteId: string) => env.NOTE.get(env.NOTE.idFromName(noteId));

const rowsOf = (noteId: string) =>
  runInDurableObject(stub(noteId), (_note: Note, state) =>
    state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM updates").one().n,
  );

describe("live sync", () => {
  it("accepts a Convex Auth token and answers with the notes protocol only", async () => {
    const peer = new TestPeer("accept", await mint());
    expect(await peer.connect()).toBe(NOTES_PROTOCOL);
    peer.disconnect();
  });

  it("converges two devices typing at once", async () => {
    const token = await mint();
    const mac = new TestPeer("two", token);
    const iphone = new TestPeer("two", token);
    await mac.connect();
    await iphone.connect();
    mac.type("Hello from the Mac. ");
    iphone.type("Hi from the iPhone. ", 0);
    await settle();
    expect(mac.value()).toBe(iphone.value());
    expect(mac.value()).toContain("Mac");
    expect(mac.value()).toContain("iPhone");
    mac.disconnect();
    iphone.disconnect();
  });

  it("catches an offline device up when it comes back", async () => {
    const token = await mint();
    const mac = new TestPeer("offline", token);
    const iphone = new TestPeer("offline", token);
    await mac.connect();
    await iphone.connect();
    mac.type("Start. ");
    await settle();
    iphone.disconnect();
    mac.type("Mac typed while the iPhone was away. ");
    iphone.type("iPhone typed offline. ");
    await settle();
    expect(iphone.value()).not.toContain("away");
    await iphone.connect();
    await settle();
    expect(iphone.value()).toBe(mac.value());
    expect(mac.value()).toContain("offline");
    expect(mac.value()).toContain("away");
    mac.disconnect();
    iphone.disconnect();
  });

  it("gives a new device the whole note from the relay alone", async () => {
    const token = await mint();
    const mac = new TestPeer("alone", token);
    await mac.connect();
    mac.type("Kept by the relay. ");
    await settle();
    mac.disconnect();
    const web = new TestPeer("alone", token);
    web.type("Typed before connecting. ");
    await web.connect();
    await settle();
    expect(web.value()).toContain("Kept by the relay.");
    expect(web.value()).toContain("Typed before connecting.");
    web.disconnect();
  });

  it("passes cursor messages through without storing them", async () => {
    const token = await mint();
    const listener = await upgrade("cursor", [NOTES_PROTOCOL, token]);
    const talker = await upgrade("cursor", [NOTES_PROTOCOL, token]);
    if (listener.webSocket) listener.webSocket.binaryType = "arraybuffer";
    listener.webSocket?.accept();
    talker.webSocket?.accept();
    const heard: Uint8Array[] = [];
    listener.webSocket?.addEventListener("message", (event) => {
      if (typeof event.data !== "string") heard.push(new Uint8Array(event.data));
    });
    await settle();
    talker.webSocket?.send(new Uint8Array([1, 3, 7, 7, 7]));
    await settle();
    expect(heard.some((m) => m[0] === 1)).toBe(true);
    expect(await rowsOf("cursor")).toBe(0);
    listener.webSocket?.close();
    talker.webSocket?.close();
  });
});

describe("storage", () => {
  it("reloads the note from SQLite after the object is evicted", async () => {
    const token = await mint();
    const mac = new TestPeer("evict", token);
    await mac.connect();
    mac.type("Survives a restart.");
    await settle();
    mac.disconnect();
    await evictDurableObject(stub("evict"));
    const fresh = new TestPeer("evict", token);
    await fresh.connect();
    await settle();
    expect(fresh.value()).toBe("Survives a restart.");
    fresh.disconnect();
  });

  it("compacts to one snapshot and keeps every keystroke", async () => {
    const token = await mint();
    const mac = new TestPeer("compact", token);
    await mac.connect();
    mac.type("x".repeat(500));
    await settle();
    mac.disconnect();
    expect(await rowsOf("compact")).toBeLessThan(COMPACT_AFTER_ROWS);
    await evictDurableObject(stub("compact"));
    const fresh = new TestPeer("compact", token);
    await fresh.connect();
    await settle();
    expect(fresh.value()).toBe("x".repeat(500));
    fresh.disconnect();
  });
});

const catchUp = (noteId: string, token: string | null, body: Uint8Array) =>
  SELF.fetch(`${BASE}${noteId}/sync`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });

const status = async (protocols: string[]) => (await upgrade("auth", protocols)).status;

describe("catch-up over HTTP", () => {

  it("sends what the device lacks and takes what it brings", async () => {
    const token = await mint();
    const mac = new TestPeer("catchup", token);
    await mac.connect();
    mac.type("From the Mac. ");
    await settle();
    mac.disconnect();

    const phone = new Y.Doc();
    phone.getText(NOTE_TEXT).insert(0, "From the phone. ");
    const response = await catchUp(
      "catchup",
      token,
      encodeCatchUpRequest({ stateVector: Y.encodeStateVector(phone), update: Y.encodeStateAsUpdate(phone) }),
    );
    expect(response.status).toBe(200);
    const answer = decodeCatchUpReply(new Uint8Array(await response.arrayBuffer()));
    Y.applyUpdate(phone, answer.update);
    expect(phone.getText(NOTE_TEXT).toString()).toContain("From the Mac.");
    expect(Y.encodeStateVector(phone)).toEqual(answer.stateVector);

    const later = new TestPeer("catchup", token);
    await later.connect();
    await settle();
    expect(later.value()).toBe(phone.getText(NOTE_TEXT).toString());
    later.disconnect();
  });

  it("refuses a missing token and a malformed body", async () => {
    expect((await catchUp("catchup-refused", null, new Uint8Array([0, 0]))).status).toBe(401);
    expect((await catchUp("catchup-refused", await mint(), new Uint8Array([200]))).status).toBe(400);
  });

  it("answers the browser preflight", async () => {
    const response = await SELF.fetch(`${BASE}any/sync`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});

describe("deleting", () => {
  it("forgets the note's storage", async () => {
    const token = await mint();
    const mac = new TestPeer("gone", token);
    await mac.connect();
    mac.type("Delete me.");
    await settle();
    mac.disconnect();
    const response = await SELF.fetch(`${BASE}gone`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(204);
    const fresh = new TestPeer("gone", token);
    await fresh.connect();
    await settle();
    expect(fresh.value()).toBe("");
    fresh.disconnect();
  });
});

describe("sign-in", () => {
  it("refuses every token Convex Auth did not issue to this deployment", async () => {
    const stranger = (await generateKeyPair("ES256")).privateKey;
    expect(await status([NOTES_PROTOCOL])).toBe(401);
    expect(await status([await mint()])).toBe(401);
    expect(await status([NOTES_PROTOCOL, await mint({ key: stranger })])).toBe(401);
    expect(await status([NOTES_PROTOCOL, await mint({ exp: Math.floor(Date.now() / 1000) - 10 })])).toBe(401);
    expect(await status([NOTES_PROTOCOL, await mint({ aud: "not-convex-auth" })])).toBe(401);
    expect(await status([NOTES_PROTOCOL, await mint({ iss: `${env.CONVEX_CLOUD_URL}/components/mcp` })])).toBe(401);
  });

  it("routes only note ids it knows the shape of", async () => {
    expect((await SELF.fetch(`${BASE}bad.id`)).status).toBe(404);
    expect((await SELF.fetch("https://relay.test/elsewhere")).status).toBe(404);
    expect((await SELF.fetch("https://relay.test/health")).status).toBe(200);
  });
});

const projected = async () =>
  ((await (await fetch(`${env.CONVEX_CLOUD_URL}/projections`)).json()) as { path: string; args: Record<string, unknown> }[]).filter(
    (call) => call.args.docId === "projected",
  );

describe("projection", () => {
  it("sends Core the note's searchable copy once it goes quiet", async () => {
    const token = await mint();
    const mac = new TestPeer("projected", token);
    mac.doc.getMap(NOTE_META).set("folder", { table: "areas", id: "area123" });
    mac.type("# Thesis outline\nRead [[task:abc123|Read papers]] and [[Dense and sparse]] for #reading.");
    await mac.connect();
    await vi.waitFor(async () => expect(await projected()).toHaveLength(1), { timeout: 3000, interval: 50 });
    mac.disconnect();
    const mine = await projected();
    expect(mine[0]?.path).toBe("notes/relay:project");
    expect(mine[0]?.args).toMatchObject({
      token: "relay-test-token",
      title: "Thesis outline",
      folder: { table: "areas", id: "area123" },
      labels: ["reading"],
      noteTitles: ["Dense and sparse"],
      entities: [{ table: "tasks", id: "abc123" }],
    });
  });
});

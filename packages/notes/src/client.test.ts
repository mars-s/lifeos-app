import { expect, test } from "vitest";
import * as Y from "yjs";
import { NoteSync, SEND_MS } from "./client.ts";
import { MessageKind, NOTE_TEXT, answerSync, readKind } from "./protocol.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeRelay = () => {
  const sent: Uint8Array[] = [];
  const listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  const socket = {
    binaryType: "arraybuffer",
    readyState: 1,
    bufferedAmount: 0,
    send: (data: Uint8Array) => void sent.push(data),
    close: () => undefined,
    addEventListener: (type: string, listener: (event: { data?: unknown }) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  const open = () => listeners.get("open")?.forEach((listener) => listener({}));
  const updates = () => sent.filter((message) => readKind(message) === MessageKind.sync && message[1] === 2);
  return { socket, sent, open, updates };
};

const connected = async () => {
  const relay = fakeRelay();
  const doc = new Y.Doc();
  const sync = new NoteSync(doc, "note", { token: async () => "token", socket: () => relay.socket });
  await sync.start();
  relay.open();
  return { relay, doc, sync, text: doc.getText(NOTE_TEXT) };
};

const received = (messages: Uint8Array[]) => {
  const copy = new Y.Doc();
  for (const message of messages) answerSync(copy, message, "relay");
  return copy.getText(NOTE_TEXT).toString();
};

test("keystrokes go out within one frame, merged into one update", async () => {
  const { relay, sync, text } = await connected();
  for (const character of "Live") text.insert(text.length, character);
  await wait(SEND_MS + 10);
  expect(relay.updates()).toHaveLength(1);
  expect(received(relay.updates())).toBe("Live");
  sync.stop();
});

test("a backed-up socket keeps merging until it drains", async () => {
  const { relay, sync, text } = await connected();
  relay.socket.bufferedAmount = 1 << 20;
  text.insert(0, "Waiting ");
  await wait(SEND_MS * 2);
  text.insert(text.length, "together");
  await wait(SEND_MS * 2);
  expect(relay.updates()).toHaveLength(0);
  relay.socket.bufferedAmount = 0;
  await wait(SEND_MS * 2);
  expect(relay.updates()).toHaveLength(1);
  expect(received(relay.updates())).toBe("Waiting together");
  sync.stop();
});

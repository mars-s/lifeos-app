import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { NoteSync, bridgedOrigin } from "@lifeos/notes/client";
import { devicePresence, mirrorPeers, ownPresence, type Awareness } from "@lifeos/notes/presence";
import { mint } from "./client.ts";

type Listener = (event: { data?: unknown }) => void;

const relaySocket = (url: string, protocols: string[]) => {
  const listeners = new Map<string, Listener[]>();
  const emit = (type: string, event: { data?: unknown }) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  let socket: WebSocket | null = null;
  void SELF.fetch(url.replace(/^ws/, "http"), {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": protocols.join(", ") },
  }).then((response) => {
    const opened = response.webSocket;
    if (!opened) return emit("close", {});
    opened.binaryType = "arraybuffer";
    opened.accept();
    socket = opened;
    opened.addEventListener("message", (event) => emit("message", { data: event.data }));
    opened.addEventListener("close", () => emit("close", {}));
    emit("open", {});
  });
  return {
    binaryType: "arraybuffer",
    get readyState() {
      return socket?.readyState ?? 0;
    },
    send: (data: Uint8Array) => socket?.send(data),
    close: (code?: number, reason?: string) => socket?.close(code ?? 1000, reason),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
};

const names = (awareness: Awareness) =>
  [...awareness.getStates().entries()]
    .filter(([clientID]) => clientID !== awareness.clientID)
    .map(([, state]) => (state as { user?: { name?: string } }).user?.name);

const soon = (check: () => void) => vi.waitFor(check, { timeout: 2000, interval: 10 });

describe("cursors between devices", () => {
  it("shows each device's cursor to the others, the iPhone's through its editor bridge", async () => {
    const token = await mint();
    const options = { token: async () => token, relayUrl: "https://relay.test", socket: relaySocket };
    const macDoc = new Y.Doc();
    const mac = new NoteSync(macDoc, "peers", { ...options, name: "Mac" });
    const phone = new NoteSync(new Y.Doc(), "peers", options);
    const editor = devicePresence(new Y.Doc(), "iPhone");
    editor.on("update", (_change: unknown, origin: unknown) => {
      if (origin === "local") phone.sharePresence(ownPresence(editor));
    });
    phone.awareness.on("update", (_change: unknown, origin: unknown) => {
      if (origin !== bridgedOrigin) mirrorPeers(editor, phone.peers(), "native");
    });
    phone.sharePresence(ownPresence(editor));

    await mac.start();
    await phone.start();
    await soon(() => {
      expect(names(mac.awareness)).toEqual(["iPhone"]);
      expect(names(editor)).toEqual(["Mac"]);
    });

    editor.setLocalStateField("cursor", { anchor: 1, head: 4 });
    await soon(() => expect(mac.awareness.getStates().get(editor.clientID)?.cursor).toEqual({ anchor: 1, head: 4 }));

    mac.stop();
    await soon(() => expect(names(editor)).toEqual([]));

    const macAgain = new NoteSync(macDoc, "peers", { ...options, name: "Mac" });
    await macAgain.start();
    await soon(() => {
      expect(names(editor)).toEqual(["Mac"]);
      expect(names(macAgain.awareness)).toEqual(["iPhone"]);
    });

    phone.disconnect();
    await soon(() => expect(names(macAgain.awareness)).toEqual([]));
    await soon(() => expect(names(editor)).toEqual([]));

    phone.stop();
    macAgain.stop();
    editor.destroy();
  });
});

import { keepEqual } from "./keep-equal";
import { createUpdaterLayer, withUpdaters } from "./reverted";

export type ViewDisk = {
  read: (key: string) => unknown;
  write: (key: string, value: unknown) => void;
};

const lastSeen = new Map<string, unknown>();
const settled = new WeakMap<object, unknown>();
const looked = new Set<string>();
let disk: ViewDisk | null = null;

export const keepViewsOn = (next: ViewDisk | null) => {
  disk = next;
};

export const lastSeenView = (key: string) => {
  if (lastSeen.has(key) || !disk || looked.has(key)) return lastSeen.get(key);
  looked.add(key);
  const saved = disk.read(key);
  if (saved !== undefined) lastSeen.set(key, saved);
  return saved;
};

export const forgetViews = () => {
  lastSeen.clear();
  looked.clear();
};

export const settleView = (key: string, live: unknown) => {
  const known = typeof live === "object" && live !== null ? settled.get(live) : undefined;
  const before = lastSeenView(key);
  const kept = known ?? keepEqual(before, live);
  if (typeof live === "object" && live !== null) settled.set(live, kept);
  lastSeen.set(key, kept);
  if (kept !== before) disk?.write(key, kept);
  return kept;
};

const unsaved = createUpdaterLayer();

export const holdUnsaved = unsaved.hold;

export const subscribeUnsaved = unsaved.subscribe;

export const readUnsaved = unsaved.read;

export const offlineView = (pending: ReturnType<typeof readUnsaved>, name: string, argsKey: string | null) =>
  argsKey === null ? undefined : withUpdaters(pending, name, argsKey, lastSeenView(`${name}:${argsKey}`));

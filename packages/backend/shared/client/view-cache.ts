import { keepEqual } from "./keep-equal";

const lastSeen = new Map<string, unknown>();
const settled = new WeakMap<object, unknown>();

export const settleView = (key: string, live: unknown) => {
  const known = typeof live === "object" && live !== null ? settled.get(live) : undefined;
  const kept = known ?? keepEqual(lastSeen.get(key), live);
  if (typeof live === "object" && live !== null) settled.set(live, kept);
  lastSeen.set(key, kept);
  return kept;
};

export const lastSeenView = (key: string) => lastSeen.get(key);

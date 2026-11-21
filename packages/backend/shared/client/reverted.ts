import { rewriteView, type Updater } from "./local-views";

const NONE: readonly Updater[] = [];

let reverts = NONE;
const listeners = new Set<() => void>();

const publish = (next: readonly Updater[]) => {
  reverts = next;
  listeners.forEach((listener) => listener());
};

export const subscribeReverted = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const readReverted = () => reverts;

export const noReverted = () => NONE;

export const showReverted = (revert: Updater) => {
  publish([...reverts, revert]);
  return () => publish(reverts.filter((each) => each !== revert));
};

export const withReverted = (pending: readonly Updater[], name: string, argsKey: string | null, live: unknown) => {
  if (pending.length === 0 || argsKey === null || live === undefined || live instanceof Error) return live;
  const args = JSON.parse(argsKey) as Record<string, unknown>;
  return pending.reduce<unknown>((shown, revert) => rewriteView(revert, name, args, shown), live);
};

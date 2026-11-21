import { rewriteView, type Updater } from "./local-views";

const NONE: readonly Updater[] = [];

export const createUpdaterLayer = () => {
  let updaters = NONE;
  const listeners = new Set<() => void>();
  const publish = (next: readonly Updater[]) => {
    updaters = next;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    read: () => updaters,
    hold: (update: Updater) => {
      publish([...updaters, update]);
      return () => publish(updaters.filter((each) => each !== update));
    },
  };
};

export const withUpdaters = (pending: readonly Updater[], name: string, argsKey: string | null, live: unknown) => {
  if (pending.length === 0 || argsKey === null || live === undefined || live instanceof Error) return live;
  const args = JSON.parse(argsKey) as Record<string, unknown>;
  return pending.reduce<unknown>((shown, update) => rewriteView(update, name, args, shown), live);
};

const reverted = createUpdaterLayer();

export const subscribeReverted = reverted.subscribe;

export const readReverted = reverted.read;

export const noReverted = () => NONE;

export const showReverted = reverted.hold;

export const withReverted = withUpdaters;

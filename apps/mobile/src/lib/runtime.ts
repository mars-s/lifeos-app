import { Effect, Layer, ManagedRuntime } from "effect";
import { KeyValueStore } from "effect/persistence";
import { SQLiteStorage } from "expo-sqlite/kv-store";

const prefs = new SQLiteStorage("lifeos-prefs");

const stored = (key: string, method: string, work: () => void) =>
  Effect.try({
    try: work,
    catch: (cause) => new KeyValueStore.KeyValueStoreError({ key, method, message: `Unable to ${method} ${key}`, cause }),
  });

const asJson = (raw: string) => (raw.startsWith('"') ? raw : JSON.stringify(raw));

export const PrefsStore = Layer.sync(KeyValueStore.KeyValueStore)(() =>
  KeyValueStore.makeStringOnly({
    get: (key) =>
      Effect.try({
        try: () => {
          const raw = prefs.getItemSync(key);
          return raw === null ? undefined : asJson(raw);
        },
        catch: (cause) => new KeyValueStore.KeyValueStoreError({ key, method: "get", message: `Unable to get ${key}`, cause }),
      }),
    set: (key, value) =>
      Effect.tryPromise({
        try: () => prefs.setItemAsync(key, value),
        catch: (cause) => new KeyValueStore.KeyValueStoreError({ key, method: "set", message: `Unable to set ${key}`, cause }),
      }),
    remove: (key) => stored(key, "remove", () => void prefs.removeItemSync(key)),
    clear: stored("", "clear", () => void prefs.clearSync()),
    size: Effect.sync(() => prefs.getAllKeysSync().length),
    keys: Effect.sync(() => prefs.getAllKeysSync()),
  }),
);

export const appRuntime = ManagedRuntime.make(PrefsStore);

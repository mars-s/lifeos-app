import { useAtomValue } from "@effect/atom-react";
import { Result } from "effect";
import { Atom } from "effect/reactivity";
import { useQueries } from "convex/react";
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { convexToJson, jsonToConvex, type JSONValue, type Value } from "convex/values";
import { SQLiteStorage } from "expo-sqlite/kv-store";
import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { noReverted, readReverted, subscribeReverted, withReverted } from "@lifeos/backend/client/reverted";
import { forgetViews, keepViewsOn, offlineView, readUnsaved, settleView, subscribeUnsaved } from "@lifeos/backend/client/view-cache";
import { localIsoDate } from "@lifeos/backend/date";

const TICK_MS = 20_000;
const SAVE_AFTER_MS = 800;
const KEEP_FOR_MS = 14 * 86_400_000;

const savedViews = new SQLiteStorage("lifeos-views");
const unsavedViews = new Map<string, unknown>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const parseSaved = (raw: string) =>
  Result.try({
    try: () => jsonToConvex(JSON.parse(raw.slice(raw.indexOf("|") + 1)) as JSONValue),
    catch: () => "unreadable" as const,
  });
const encodeView = (value: unknown) =>
  Result.try({ try: () => JSON.stringify(convexToJson(value as Value)), catch: () => "unencodable" as const });

const saveViews = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const at = Date.now();
  const rows = [...unsavedViews].flatMap(([key, value]) => Result.match(encodeView(value), {
      onSuccess: (json) => [[key, `${at}|${json}`] as [string, string]],
      onFailure: () => [],
    }));
  unsavedViews.clear();
  if (rows.length > 0) void savedViews.multiSet(rows);
};

keepViewsOn({
  read: (key) => {
    const raw = savedViews.getItemSync(key);
    return raw === null ? undefined : Result.getOrUndefined(parseSaved(raw));
  },
  write: (key, value) => {
    unsavedViews.set(key, value);
    saveTimer ??= setTimeout(saveViews, SAVE_AFTER_MS);
  },
});

AppState.addEventListener("change", (state) => {
  if (state !== "active") saveViews();
});

const PRUNE_AFTER_MS = 10_000;

const pruneSavedViews = async () => {
  const keys = await savedViews.getAllKeysAsync();
  const rows = await savedViews.multiGet(keys);
  const oldest = Date.now() - KEEP_FOR_MS;
  const stale = rows.flatMap(([key, raw]) => (raw === null || Number(raw.slice(0, raw.indexOf("|"))) < oldest ? [key] : []));
  if (stale.length > 0) await savedViews.multiRemove(stale);
};

setTimeout(() => void pruneSavedViews(), PRUNE_AFTER_MS);

export const forgetSavedViews = async () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  unsavedViews.clear();
  forgetViews();
  await savedViews.clearAsync();
};

const readLocalDate = () => localIsoDate(new Date());

const localDateAtom = Atom.make((get) => {
  const refresh = () => get.setSelf(readLocalDate());
  const timer = setInterval(refresh, TICK_MS);
  const focus = AppState.addEventListener("change", refresh);
  get.addFinalizer(() => {
    clearInterval(timer);
    focus.remove();
  });
  return readLocalDate();
});

export const useLocalDate = () => useAtomValue(localDateAtom);

export const useViewState = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const name = getFunctionName(query);
  const argsKey = args === "skip" ? null : JSON.stringify(args);
  const queries = useMemo(() => {
    const request: Parameters<typeof useQueries>[0] = {};
    if (argsKey !== null) request.view = { query: makeFunctionReference<"query">(name), args: JSON.parse(argsKey) as Record<string, never> };
    return request;
  }, [name, argsKey]);
  const live: unknown = useQueries(queries).view;
  const pending = useSyncExternalStore(subscribeReverted, readReverted, noReverted);
  const key = argsKey === null ? null : `${name}:${argsKey}`;
  const waiting = live === undefined;
  const unsaved = useSyncExternalStore(subscribeUnsaved, waiting ? readUnsaved : noReverted, noReverted);
  const kept = key === null || waiting || live instanceof Error ? live : settleView(key, live);
  const offline = useMemo(() => (waiting ? offlineView(unsaved, name, argsKey) : undefined), [waiting, unsaved, name, argsKey]);
  const base = waiting ? offline : kept;
  const shown = useMemo(() => withReverted(pending, name, argsKey, base), [pending, name, argsKey, base]);
  if (live instanceof Error) return { value: undefined, error: live };
  return { value: shown as FunctionReturnType<Query> | undefined, error: null };
};

export const useView = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const { value, error } = useViewState(query, args);
  if (error) throw error;
  return value;
};

export const valueOf = <T,>(response: { ok: true; value: T } | { ok: false; error: unknown } | undefined) =>
  response?.ok ? response.value : undefined;

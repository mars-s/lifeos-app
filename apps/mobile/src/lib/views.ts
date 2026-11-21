import { useQueries } from "convex/react";
import { getFunctionName, makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { noReverted, readReverted, subscribeReverted, withReverted } from "@lifeos/backend/client/reverted";
import { lastSeenView, settleView } from "@lifeos/backend/client/view-cache";
import { localIsoDate } from "@lifeos/backend/date";

const TICK_MS = 20_000;

const subscribeTick = (onChange: () => void) => {
  const timer = setInterval(onChange, TICK_MS);
  const focus = AppState.addEventListener("change", onChange);
  return () => {
    clearInterval(timer);
    focus.remove();
  };
};

const readLocalDate = () => localIsoDate(new Date());

export const useLocalDate = () => useSyncExternalStore(subscribeTick, readLocalDate, readLocalDate);

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
  const kept = key === null || live === undefined || live instanceof Error ? live : settleView(key, live);
  const shown = useMemo(() => withReverted(pending, name, argsKey, kept), [pending, name, argsKey, kept]);
  if (live instanceof Error) return { value: undefined, error: live };
  return { value: (shown ?? (key ? lastSeenView(key) : undefined)) as FunctionReturnType<Query> | undefined, error: null };
};

export const useView = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const { value, error } = useViewState(query, args);
  if (error) throw error;
  return value;
};

export const valueOf = <T,>(response: { ok: true; value: T } | { ok: false; error: unknown } | undefined) =>
  response?.ok ? response.value : undefined;

"use client";

import { useQueries } from "convex/react";
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import { useMemo, useSyncExternalStore } from "react";
import { localIsoDate } from "@lifeos/backend/date";
import { keepEqual } from "@/lib/keep-equal";
import { useReverted } from "./reverted-views";

const TICK_MS = 20_000;

const subscribeTick = (onChange: () => void) => {
  const timer = setInterval(onChange, TICK_MS);
  window.addEventListener("focus", onChange);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onChange);
  };
};

const readLocalDate = () => localIsoDate(new Date());
const readTick = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const readNothing = () => null;

export const useLocalDate = () => useSyncExternalStore(subscribeTick, readLocalDate, readNothing);

export const useNow = () => useSyncExternalStore(subscribeTick, readTick, readNothing);

const lastSeen = new Map<string, unknown>();
const settled = new WeakMap<object, unknown>();

const settle = (key: string, live: unknown) => {
  const known = typeof live === "object" && live !== null ? settled.get(live) : undefined;
  const kept = known ?? keepEqual(lastSeen.get(key), live);
  if (typeof live === "object" && live !== null) settled.set(live, kept);
  lastSeen.set(key, kept);
  return kept;
};

const failing = () =>
  import.meta.env.DEV && typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("__fail") ?? "") : "";

const referenceFor = (name: string) => {
  const fault = failing();
  return makeFunctionReference<"query">(fault !== "" && name.includes(fault) ? "planner/missing:fn" : name);
};

export const useViewState = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const name = getFunctionName(query);
  const argsKey = args === "skip" ? null : JSON.stringify(args);
  const queries = useMemo(() => {
    const request: Parameters<typeof useQueries>[0] = {};
    if (argsKey !== null) request.view = { query: referenceFor(name), args: JSON.parse(argsKey) as Record<string, never> };
    return request;
  }, [name, argsKey]);
  const live: unknown = useQueries(queries).view;
  const key = argsKey === null ? null : `${name}:${argsKey}`;
  const kept = key === null || live === undefined || live instanceof Error ? live : settle(key, live);
  const shown = useReverted(name, argsKey, kept);
  if (live instanceof Error) return { value: undefined, error: live };
  return { value: (shown ?? (key ? lastSeen.get(key) : undefined)) as FunctionReturnType<Query> | undefined, error: null };
};

export const useView = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const { value, error } = useViewState(query, args);
  if (error) throw error;
  return value;
};

export const useQuietView = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") =>
  useViewState(query, args).value;

export const valueOf = <T>(response: { ok: true; value: T } | { ok: false; error: unknown } | undefined) =>
  response?.ok ? response.value : undefined;

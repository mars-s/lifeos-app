"use client";

import { useQuery } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useSyncExternalStore } from "react";
import { localIsoDate } from "@lifeos/backend/date";

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

export const useView = <Query extends FunctionReference<"query">>(query: Query, args: FunctionArgs<Query> | "skip") => {
  const live = useQuery(query, ...([args] as never));
  const key = args === "skip" ? null : `${getFunctionName(query)}:${JSON.stringify(args)}`;
  if (key && live !== undefined) lastSeen.set(key, live);
  return (live ?? (key ? lastSeen.get(key) : undefined)) as FunctionReturnType<Query> | undefined;
};

export const valueOf = <T>(response: { ok: true; value: T } | { ok: false; error: unknown } | undefined) =>
  response?.ok ? response.value : undefined;

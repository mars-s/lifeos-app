import type { OptimisticLocalStore } from "convex/browser";
import { getFunctionName, type FunctionReference } from "convex/server";

export type Updater = (store: OptimisticLocalStore) => void;

export type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);

const sorted = (_key: string, value: unknown) =>
  isNode(value) ? Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value;

const argsKey = (args: unknown) => JSON.stringify(args ?? {}, sorted);

export const rewriteView = (update: Updater, name: string, args: Record<string, unknown>, value: unknown) => {
  const key = argsKey(args);
  const holds = (query: FunctionReference<"query">, queryArgs: unknown) => getFunctionName(query) === name && argsKey(queryArgs) === key;
  let shown = value;
  const store = {
    getQuery: (query: FunctionReference<"query">, queryArgs?: unknown) => (holds(query, queryArgs) ? shown : undefined),
    getAllQueries: (query: FunctionReference<"query">) => (getFunctionName(query) === name ? [{ args, value: shown }] : []),
    setQuery: (query: FunctionReference<"query">, queryArgs: unknown, next: unknown) => {
      if (holds(query, queryArgs)) shown = next;
    },
  };
  update(store as unknown as OptimisticLocalStore);
  return shown;
};

const idOf = (value: unknown) => {
  if (!isNode(value)) return undefined;
  const id = value._id ?? value.key ?? value.date;
  return typeof id === "string" ? id : undefined;
};

const holdsAny: (value: unknown, wanted: (node: Node) => boolean) => boolean = (value, wanted) => {
  if (Array.isArray(value)) return value.some((inner) => holdsAny(inner, wanted));
  if (!isNode(value)) return false;
  return wanted(value) || Object.values(value).some((inner) => holdsAny(inner, wanted));
};

const unchanged = (next: readonly unknown[], now: readonly unknown[]) => next.length === now.length && next.every((inner, index) => inner === now[index]);

export const putBack: (before: unknown, now: unknown, gone: (node: Node) => boolean) => unknown = (before, now, gone) => {
  if (Array.isArray(before) && Array.isArray(now)) {
    const named = [...before, ...now].every((each) => idOf(each) !== undefined);
    if (!named) {
      const next = now.map((each, index) => (index < before.length ? putBack(before[index], each, gone) : each));
      return unchanged(next, now) ? now : next;
    }
    const was = new Map(before.map((each) => [idOf(each), each]));
    const next = now.map((each) => (was.has(idOf(each)) ? putBack(was.get(idOf(each)), each, gone) : each));
    const here = new Set(now.map(idOf));
    for (const [index, lost] of before.entries()) {
      if (here.has(idOf(lost)) || !holdsAny(lost, gone)) continue;
      const earlier = new Set(before.slice(0, index).map(idOf));
      next.splice(next.findLastIndex((each) => earlier.has(idOf(each))) + 1, 0, lost);
    }
    return unchanged(next, now) ? now : next;
  }
  if (!isNode(before) || !isNode(now)) return now;
  const entries = Object.entries(now).map(([key, inner]) => [key, putBack(before[key], inner, gone)] as const);
  return entries.some(([key, inner]) => inner !== now[key]) ? Object.fromEntries(entries) : now;
};

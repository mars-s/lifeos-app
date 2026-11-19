export type Recent = { kind: "task" | "project" | "area" | "list"; id: string };

const KEY = "lifeos:bar:recents:v1";
const LIMIT = 6;

const isRecent = (value: unknown): value is Recent =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Recent).id === "string" &&
  ["task", "project", "area", "list"].includes((value as Recent).kind);

let cached: readonly Recent[] | undefined;

export const readRecents = () => {
  if (cached) return cached;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cached = Array.isArray(stored) ? stored.filter(isRecent).slice(0, LIMIT) : [];
  } catch {
    cached = [];
  }
  return cached;
};

export const rememberRecent = (recent: Recent) => {
  cached = [recent, ...readRecents().filter((other) => other.kind !== recent.kind || other.id !== recent.id)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    return;
  }
};

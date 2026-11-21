type Node = Record<string, unknown>;

const isPlain = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const idOf = (value: unknown) => (isPlain(value) && typeof value._id === "string" ? value._id : undefined);

const keepList: (before: readonly unknown[], after: readonly unknown[]) => readonly unknown[] = (before, after) => {
  const known = new Map(before.flatMap((item) => (idOf(item) === undefined ? [] : [[idOf(item), item] as const])));
  const next = after.map((item, index) => {
    const id = idOf(item);
    return keepEqual(id === undefined ? before[index] : known.get(id), item);
  });
  return next.length === before.length && next.every((item, index) => item === before[index]) ? before : next;
};

const keepNode: (before: Node, after: Node) => Node = (before, after) => {
  const keys = Object.keys(after);
  const next = Object.fromEntries(keys.map((key) => [key, keepEqual(before[key], after[key])]));
  const same = keys.length === Object.keys(before).length && keys.every((key) => key in before && next[key] === before[key]);
  return same ? before : next;
};

export const keepEqual: <Value>(before: unknown, after: Value) => Value = (before, after) => {
  if (before === after) return after;
  if (Array.isArray(after)) return (Array.isArray(before) ? keepList(before, after) : after) as typeof after;
  return (isPlain(before) && isPlain(after) ? keepNode(before, after) : after) as typeof after;
};

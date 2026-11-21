import { expect, test } from "vitest";
import { keepEqual } from "./keep-equal";

const task = (id: string, title: string) => ({ _id: id, title, labels: [{ _id: "l1", name: "Admin" }], when: { kind: "inbox" } });

test("an equal answer keeps the object the screen already holds", () => {
  const before = { ok: true, value: { tasks: [task("a", "One"), task("b", "Two")] } };
  const after = { ok: true, value: { tasks: [task("a", "One"), task("b", "Two")] } };

  expect(keepEqual(before, after)).toBe(before);
});

test("only the Task that changed becomes a new object", () => {
  const before = { tasks: [task("a", "One"), task("b", "Two")] };
  const after = { tasks: [task("a", "One"), task("b", "Two, renamed")] };

  const kept = keepEqual(before, after);

  expect(kept).toEqual(after);
  expect(kept).not.toBe(before);
  expect(kept.tasks[0]).toBe(before.tasks[0]);
  expect(kept.tasks[1]).not.toBe(before.tasks[1]);
  expect(kept.tasks[1]?.labels).toBe(before.tasks[1]?.labels);
});

test("Tasks keep their objects when one is added, removed or moved", () => {
  const before = [task("a", "One"), task("b", "Two"), task("c", "Three")];
  const after = [task("c", "Three"), task("new", "Fresh"), task("a", "One")];

  const kept = keepEqual(before, after);

  expect(kept).toEqual(after);
  expect(kept[0]).toBe(before[2]);
  expect(kept[2]).toBe(before[0]);
});

test("a field that disappears or appears makes a new object", () => {
  const before = { _id: "a", title: "One", deadline: "2026-11-20" };

  expect(keepEqual(before, { _id: "a", title: "One" })).toEqual({ _id: "a", title: "One" });
  expect(keepEqual({ _id: "a", title: "One" }, before)).toEqual(before);
});

test("values that are not plain data are taken as they come", () => {
  const before = { bytes: new Uint8Array([1, 2]).buffer, count: 1n };
  const after = { bytes: new Uint8Array([3, 4]).buffer, count: 1n };

  expect(keepEqual(before, after).bytes).toBe(after.bytes);
  expect(keepEqual(undefined, after)).toBe(after);
  expect(keepEqual(before, null)).toBeNull();
});

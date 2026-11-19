import { beforeEach, describe, expect, test } from "vitest";
import type { PlannerTask } from "@lifeos/backend/types";
import { selection } from "./selection";

const task = (id: string) => ({ _id: id, title: id }) as unknown as PlannerTask;

const nextTick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("selection", () => {
  beforeEach(async () => {
    selection.clear();
    await nextTick();
  });

  test("a row that is taken away loses its selection", async () => {
    selection.register("a", task("a"));
    selection.only("a");
    selection.forget("a");
    await nextTick();
    expect(selection.has("a")).toBe(false);
    expect(selection.task("a")).toBeUndefined();
  });

  test("a row that swaps between drawn and not drawn in one commit keeps its selection and its Task", async () => {
    selection.register("a", task("a"));
    selection.register("b", task("b"));
    selection.set(["a", "b"]);
    const swapped = task("a");
    selection.forget("a");
    selection.register("a", swapped);
    await nextTick();
    expect(selection.keys()).toEqual(["a", "b"]);
    expect(selection.task("a")).toBe(swapped);
  });

  test("taking one selected row away leaves the others selected", async () => {
    selection.register("a", task("a"));
    selection.register("b", task("b"));
    selection.set(["a", "b"]);
    selection.forget("a");
    await nextTick();
    expect(selection.keys()).toEqual(["b"]);
  });
});

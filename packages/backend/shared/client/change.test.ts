import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { createChange, noDrafts, type ChangeHost } from "./change";
import { nothing } from "./updaters";
import { createUndoStack } from "./undo-stack";

type Shown = { id: string; title: string; undo: () => void; onClose: () => void };

const newHost = (answer: (args: Record<string, unknown>) => Awaited<ReturnType<ChangeHost["mutate"]>>) => {
  const shown = new Map<string, Shown>();
  const sent: Record<string, unknown>[] = [];
  const refused: string[] = [];
  const stack = createUndoStack({
    show: (title, { id, action, onClose }) => void shown.set(id, { id, title, undo: action.onClick, onClose }),
    dismiss: (id) => {
      shown.get(id)?.onClose();
      shown.delete(id);
    },
  });
  const change = createChange({
    mutate: async (_mutation, args) => {
      sent.push(args);
      return answer(args);
    },
    showUndo: stack.showUndo,
    say: nothing,
    refuse: (_title, reason) => void refused.push(reason),
    drafts: noDrafts,
  });
  return { change, stack, shown, sent, refused };
};

const taskId = "task1" as Id<"tasks">;
const activityId = "activity1" as Id<"activity">;
const saved = { ok: true, value: { activityId } } as const;

const complete = (slot?: string) => ({
  title: "Completed Buy milk",
  mutation: api.planner.tasks.complete,
  args: { taskId },
  apply: nothing,
  revert: nothing,
  ...(slot ? { slot } : {}),
});

describe("a change", () => {
  test("raises an undo toast at once and undo reverts the saved Activity", async () => {
    const host = newHost((args) => ("activityId" in args ? { ok: true, value: { activityId: null } } : saved));

    const done = host.change(complete());
    expect([...host.shown.values()].map((toast) => toast.title)).toEqual(["Completed Buy milk"]);
    expect(await done).toBe(true);

    expect(host.stack.undoLast()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(host.sent).toEqual([{ taskId }, { activityId }]);
    expect(host.stack.canUndo()).toBe(false);
  });

  test("a refused change says why and takes its undo toast away", async () => {
    const host = newHost(() => ({ ok: false, error: { kind: "not_found" } }));

    expect(await host.change(complete())).toBe(false);

    expect(host.refused).toEqual(["It was removed somewhere else."]);
    expect(host.shown.size).toBe(0);
    expect(host.stack.canUndo()).toBe(false);
  });

  test("changes that share a slot reuse one toast, and undo runs the newest first", async () => {
    const host = newHost(() => saved);

    await host.change(complete("card:task1"));
    await host.change({ ...complete("card:task1"), title: "Moved to Tomorrow" });

    expect([...host.shown.values()].map((toast) => toast.title)).toEqual(["Moved to Tomorrow"]);
    expect(host.stack.undoLast()).toBe(true);
    expect(host.stack.canUndo()).toBe(true);
  });
});

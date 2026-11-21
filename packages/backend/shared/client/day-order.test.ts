import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PlannerTask } from "../types";
import { dayPlacement } from "./day-order";
import { rewriteView } from "./local-views";
import { showNewTask } from "./updaters";

const TODAY = "2026-11-21";
const MONDAY = "2026-11-23";

const task = (title: string, when: PlannerTask["when"] = { kind: "scheduled", date: TODAY, evening: false }) =>
  ({
    _id: title,
    _creationTime: 0,
    title,
    notes: "",
    when,
    parent: { kind: "loose" },
    labelIds: [],
    status: { kind: "open" },
    order: "a0",
    labels: [],
    checklist: [],
    workBlocks: [],
    focus: { ms: 0, sessions: [] },
  }) as unknown as PlannerTask;

const titles = (tasks: readonly PlannerTask[]) => tasks.map((row) => row.title);
const realIdOf = (id: Id<"tasks">) => id;
type Today = { ok: true; value: { date: string; tasks: PlannerTask[]; evening: PlannerTask[] } };

const todayOf = (tasks: PlannerTask[], evening: PlannerTask[] = []) => ({ ok: true, value: { date: TODAY, tasks, evening } }) as Today;
const inToday = (update: Parameters<typeof rewriteView>[0], view: Today) => rewriteView(update, "planner/today:get", { date: TODAY }, view) as Today;

describe("dayPlacement", () => {
  const [gym, read, call] = [task("Gym"), task("Read"), task("Call")];
  const dinner = task("Dinner", { kind: "scheduled", date: TODAY, evening: true });

  test("moves a Task to its new place in Today in the same frame, and its revert puts it back", () => {
    const placing = dayPlacement({ task: call, from: [gym, read, call], to: { day: { date: TODAY, evening: false }, tasks: [gym, read, call] }, at: 0, today: TODAY, realIdOf });
    const moved = inToday(placing.apply, todayOf([gym, read, call]));
    expect(titles(moved.value.tasks)).toEqual(["Call", "Gym", "Read"]);
    expect(placing.args.order).toEqual(["Call", "Gym", "Read"]);
    expect(titles(inToday(placing.revert, moved).value.tasks)).toEqual(["Gym", "Read", "Call"]);
  });

  test("moves a Task from Today into This Evening and says so", () => {
    const placing = dayPlacement({ task: gym, from: [gym, read], to: { day: { date: TODAY, evening: true }, tasks: [dinner] }, at: 1, today: TODAY, realIdOf });
    const moved = inToday(placing.apply, todayOf([gym, read], [dinner]));
    expect([titles(moved.value.tasks), titles(moved.value.evening)]).toEqual([["Read"], ["Dinner", "Gym"]]);
    expect(moved.value.evening[1]?.when).toEqual({ kind: "scheduled", date: TODAY, evening: true });
    expect(placing.title).toBe("Moved to This Evening");
  });

  test("moves a Task between Upcoming days", () => {
    const tuesday = "2026-11-24";
    const one = task("One", { kind: "scheduled", date: MONDAY, evening: false });
    const two = task("Two", { kind: "scheduled", date: tuesday, evening: false });
    const view = { ok: true, value: { date: TODAY, until: "2026-12-05", days: [{ date: MONDAY, tasks: [one], deadlines: [] }, { date: tuesday, tasks: [two], deadlines: [] }] } };
    const placing = dayPlacement({ task: one, from: [one], to: { day: { date: tuesday, evening: false }, tasks: [two] }, at: 1, today: TODAY, realIdOf });
    const moved = rewriteView(placing.apply, "planner/lists:upcoming", { date: TODAY, days: 14 }, view) as typeof view;
    expect(moved.value.days.map((day) => [day.date, titles(day.tasks)])).toEqual([[MONDAY, []], [tuesday, ["Two", "One"]]]);
  });
});

test("a new Task dropped mid-Today shows at that spot", () => {
  const fresh = task("New");
  const shown = inToday(showNewTask(fresh, TODAY, ["Gym", "New", "Read"]), todayOf([task("Gym"), task("Read")]));
  expect(titles(shown.value.tasks)).toEqual(["Gym", "New", "Read"]);
});

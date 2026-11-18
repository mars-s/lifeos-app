import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap } from "../backend.test-utils";

const nineAm = Date.UTC(2026, 10, 18, 22, 0);
const minute = 60_000;
const open = { kind: "open" } as const;
const pomodoro = { kind: "pomodoro", focusMinutes: 25, breakMinutes: 5 } as const;

let clock = nineAm;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: nineAm - minute });
  clock = nineAm;
});

afterEach(() => {
  vi.useRealTimers();
});

const wholeSeconds = (ms: number) => Math.round(ms / 1000) * 1000;

const after = (minutes: number) => {
  clock += minutes * minute;
  vi.setSystemTime(clock);
};

const setup = async () => {
  const t = await newBackend();
  const make = async (title: string) => unwrap(await t.mutation(api.planner.tasks.create, { title, estimateMinutes: 60 })).taskId;
  const [first, second] = [await make("Write chapter two"), await make("Mark the quizzes")];
  after(0);
  const current = () => t.query(api.planner.focus.current, {});
  const actualMinutes = async (taskId: Id<"tasks">) => {
    const { tasks } = await t.query(api.planner.lists.inbox, {});
    return wholeSeconds(tasks.find((task) => task._id === taskId)?.focus.ms ?? 0) / minute;
  };
  const begin = async (taskId: Id<"tasks">, plan: typeof open | typeof pomodoro = open) =>
    unwrap(await t.mutation(api.planner.focus.start, { taskId, plan }));
  return { t, first, second, current, actualMinutes, begin };
};

test("only one Focus Session runs at a time, and starting another switches cleanly", async () => {
  const { t, first, second, current, actualMinutes, begin } = await setup();
  const one = await begin(first);
  expect(await begin(first)).toMatchObject({ sessionId: one.sessionId, replaced: null });

  after(12);
  const two = await begin(second);
  expect(two.replaced).toBe(one.sessionId);
  expect(await current()).toMatchObject({ _id: two.sessionId, taskId: second, title: "Mark the quizzes", state: { kind: "running" } });
  expect(await actualMinutes(first)).toBe(12);
  const active = await t.run((ctx) =>
    ctx.db
      .query("focusSessions")
      .collect()
      .then((sessions) => sessions.filter((session) => session.state.kind !== "ended")),
  );
  expect(active).toHaveLength(1);

  unwrap(await t.mutation(api.platform.undo.undo, { activityId: two.activityId! }));
  expect(await current()).toMatchObject({ _id: one.sessionId, taskId: first, state: { kind: "running" } });
  expect(await actualMinutes(first)).toBe(0);
});

test("paused time never counts, however often the session is paused or resumed", async () => {
  const { t, first, current, actualMinutes, begin } = await setup();
  const { sessionId } = await begin(first);
  after(10);
  unwrap(await t.mutation(api.planner.focus.pause, { sessionId }));
  after(5);
  expect(unwrap(await t.mutation(api.planner.focus.pause, { sessionId })).changed).toBe(false);
  expect(await current()).toMatchObject({ state: { kind: "paused", at: nineAm + 10 * minute }, pausedMs: 0 });
  unwrap(await t.mutation(api.planner.focus.resume, { sessionId }));
  expect(unwrap(await t.mutation(api.planner.focus.resume, { sessionId })).changed).toBe(false);
  expect(await current()).toMatchObject({ state: { kind: "running" }, pausedMs: 5 * minute });
  after(20);
  unwrap(await t.mutation(api.planner.focus.pause, { sessionId }));
  after(45);
  unwrap(await t.mutation(api.planner.focus.stop, { sessionId }));

  expect(await current()).toBeNull();
  expect(await actualMinutes(first)).toBe(30);
  expect(await t.mutation(api.planner.focus.resume, { sessionId })).toEqual({
    ok: false,
    error: { kind: "invalid_focus", reason: "not_active" },
  });
});

test("Actual Time is the sum of a Task's focus time: breaks, removed sessions and time past the plan stay out", async () => {
  const { t, first, second, actualMinutes, begin } = await setup();
  const one = await begin(first);
  after(20);
  unwrap(await t.mutation(api.planner.focus.stop, { sessionId: one.sessionId }));
  after(60);
  const two = await begin(first, pomodoro);
  after(90);
  const rest = unwrap(await t.mutation(api.planner.focus.advance, { sessionId: two.sessionId }));
  after(5);
  unwrap(await t.mutation(api.planner.focus.stop, { sessionId: rest.sessionId }));
  expect(await actualMinutes(first)).toBe(45);
  expect(await actualMinutes(second)).toBe(0);

  const { tasks } = await t.query(api.planner.lists.inbox, {});
  expect(tasks.find((task) => task._id === first)?.focus.sessions.map((session) => wholeSeconds(session.ms) / minute)).toEqual([25, 20]);

  const edited = unwrap(await t.mutation(api.planner.focus.setMinutes, { sessionId: two.sessionId, minutes: 40 }));
  expect(await actualMinutes(first)).toBe(60);
  const removed = unwrap(await t.mutation(api.planner.focus.remove, { sessionId: one.sessionId }));
  expect(await actualMinutes(first)).toBe(40);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: removed.activityId! }));
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: edited.activityId! }));
  expect(await actualMinutes(first)).toBe(45);

  const blip = await begin(second);
  after(0.5);
  unwrap(await t.mutation(api.planner.focus.stop, { sessionId: blip.sessionId }));
  const rows = await t.query(api.planner.lists.inbox, {});
  expect(rows.tasks.find((task) => task._id === second)?.focus).toEqual({ ms: 0, sessions: [] });

  expect(await t.mutation(api.planner.focus.setMinutes, { sessionId: one.sessionId, minutes: 0 })).toEqual({
    ok: false,
    error: { kind: "invalid_focus", reason: "minutes" },
  });
});

test("Pomodoro moves from focus to a break and back on the same Task, and an extension forgives the overtime", async () => {
  const { t, first, current, actualMinutes, begin } = await setup();
  const focus = await begin(first, pomodoro);
  expect(await current()).toMatchObject({ kind: "focus", plannedMinutes: 25, pomodoro: { focusMinutes: 25, breakMinutes: 5 } });

  after(40);
  unwrap(await t.mutation(api.planner.focus.extend, { sessionId: focus.sessionId, minutes: 5 }));
  expect(await current()).toMatchObject({ plannedMinutes: 30, pausedMs: 15 * minute });
  after(3);
  const rest = unwrap(await t.mutation(api.planner.focus.advance, { sessionId: focus.sessionId }));
  expect(await current()).toMatchObject({ _id: rest.sessionId, kind: "break", taskId: first, plannedMinutes: 5, start: clock });
  expect(await actualMinutes(first)).toBe(28);

  after(2);
  const again = unwrap(await t.mutation(api.planner.focus.advance, { sessionId: rest.sessionId }));
  expect(await current()).toMatchObject({ _id: again.sessionId, kind: "focus", plannedMinutes: 25, state: { kind: "running" } });

  unwrap(await t.mutation(api.planner.focus.setPlan, { sessionId: again.sessionId, plan: open }));
  expect(await current()).not.toHaveProperty("plannedMinutes");
  expect(await t.mutation(api.planner.focus.advance, { sessionId: again.sessionId })).toEqual({
    ok: false,
    error: { kind: "invalid_focus", reason: "not_pomodoro" },
  });
  expect(await t.mutation(api.planner.focus.extend, { sessionId: again.sessionId, minutes: 5 })).toEqual({
    ok: false,
    error: { kind: "invalid_focus", reason: "not_timed" },
  });
  after(50);
  unwrap(await t.mutation(api.planner.focus.setPlan, { sessionId: again.sessionId, plan: pomodoro }));
  expect(await current()).toMatchObject({ plannedMinutes: 50 });
});

test("completing or trashing the Task ends its Focus Session, and a closed Task cannot start one", async () => {
  const { t, first, second, current, actualMinutes, begin } = await setup();
  await begin(first);
  after(15);
  const completed = unwrap(await t.mutation(api.planner.tasks.complete, { taskId: first }));
  expect(await current()).toBeNull();
  expect(await t.mutation(api.planner.focus.start, { taskId: first, plan: open })).toEqual({
    ok: false,
    error: { kind: "invalid_focus", reason: "task_closed" },
  });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: completed.activityId! }));
  expect(await current()).toMatchObject({ taskId: first, state: { kind: "running" } });

  after(0);
  await begin(second);
  expect(await actualMinutes(first)).toBe(15);
  after(7);
  unwrap(await t.mutation(api.planner.selection.trash, { taskIds: [second] }));
  expect(await current()).toBeNull();
  expect(await t.mutation(api.planner.focus.start, { taskId: second, plan: { kind: "pomodoro", focusMinutes: 0, breakMinutes: 5 } })).toMatchObject({
    ok: false,
  });
});

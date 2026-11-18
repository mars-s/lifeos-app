import { expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { drainJobs, newBackend, registerWorker, unwrap, type Backend } from "../backend.test-utils";

const startAgentRun = async (t: Backend) => {
  const token = await registerWorker(t, "home-server", ["agent"]);
  await t.mutation(internal.platform.jobs.enqueue, {
    job: { kind: "agent", payload: { request: "Plan my thesis week" } },
    idempotencyKey: "agent:plan-thesis-week",
  });
  const claimed = await t.mutation(api.platform.jobs.claim, { token });
  return { token, jobId: claimed!.jobId };
};

const setup = async () => {
  const t = newBackend();
  const things = await registerWorker(t, "things", ["things"]);
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Draft intro" }));
  await drainJobs(t, things);
  const card = async (id: Id<"tasks"> = taskId) => t.query(api.planner.tasks.card, { taskId: id });
  return { t, things, taskId, card };
};

test("a whole Agent Run, across several actions and changes, undoes in one step", async () => {
  const { t, things, taskId, card } = await setup();
  const before = await card();
  const agentRun = await startAgentRun(t);
  unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the introduction", agentRun }));
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 50, agentRun }));
  const { taskId: added } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor", agentRun }));
  unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Find three sources", agentRun }));
  await drainJobs(t, things);

  const { undoActivityId } = unwrap(await t.mutation(api.platform.undo.undoRun, { jobId: agentRun.jobId }));
  expect(undoActivityId).not.toBeNull();
  expect(await card()).toEqual(before);
  expect(await card(added)).toBeNull();
  expect(
    (await drainJobs(t, things)).map(({ job }) => job.kind === "things" && [job.payload.op, job.payload.entity.id]),
  ).toEqual([
    ["delete", added],
    ["update", taskId],
  ]);
  expect(await t.mutation(api.platform.undo.undoRun, { jobId: agentRun.jobId })).toEqual({
    ok: false,
    error: { kind: "already_undone" },
  });
});

test("Agent Run actions are recorded with the run as the actor, and a finished run cannot act", async () => {
  const { t, taskId } = await setup();
  const agentRun = await startAgentRun(t);
  const { activityId } = unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Agent title", agentRun }));
  expect(await t.run((ctx) => ctx.db.get("activity", activityId!))).toMatchObject({
    actor: { kind: "agentRun", jobId: agentRun.jobId },
    action: "task.rename",
  });
  unwrap(await t.mutation(api.platform.jobs.complete, { token: agentRun.token, jobId: agentRun.jobId, receipt: null }));
  await expect(t.mutation(api.planner.tasks.rename, { taskId, title: "Too late", agentRun })).rejects.toThrow(
    "This Agent Run is not active.",
  );
});

test("an action undoes once; undoing it again or undoing an undo is refused", async () => {
  const { t, taskId } = await setup();
  const { activityId } = unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renamed" }));
  const { undoActivityId } = unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await t.mutation(api.platform.undo.undo, { activityId: activityId! })).toEqual({
    ok: false,
    error: { kind: "already_undone" },
  });
  expect(await t.mutation(api.platform.undo.undo, { activityId: undoActivityId! })).toEqual({
    ok: false,
    error: { kind: "not_undoable", reason: "undo" },
  });
});

test("undo refuses, and changes nothing, when a later action changed the same fields", async () => {
  const { t, taskId, card } = await setup();
  const first = unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "First" }));
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 20 }));
  unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Second" }));
  const before = await card();
  expect(await t.mutation(api.platform.undo.undo, { activityId: first.activityId! })).toEqual({
    ok: false,
    error: { kind: "changed_since", entity: { table: "tasks", id: taskId } },
  });
  expect(await card()).toEqual(before);
});

test("undo of one action leaves a later change to other fields in place", async () => {
  const { t, taskId, card } = await setup();
  const renamed = unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renamed" }));
  unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 20 }));
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: renamed.activityId! }));
  expect(await card()).toMatchObject({ title: "Draft intro", estimateMinutes: 20 });
});

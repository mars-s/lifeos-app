import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";

const thingsJobFor = (id: Id<"tasks">) => ({
  kind: "things" as const,
  payload: { op: "update" as const, entity: { table: "tasks" as const, id }, set: { title: "Walk" } },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 18, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = async () => {
  const t = newBackend();
  const mac = await registerWorker(t, "mac", ["things"]);
  const server = await registerWorker(t, "home-server", ["agent"]);
  const taskId = await t.run((ctx) =>
    ctx.db.insert("tasks", {
      title: "Walk",
      notes: "",
      when: { kind: "anytime" },
      parent: { kind: "loose" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
    }),
  );
  const thingsJob = thingsJobFor(taskId);
  const jobId = await t.mutation(internal.platform.jobs.enqueue, { job: thingsJob, idempotencyKey: "things:1" });
  return { t, mac, server, jobId, thingsJob };
};

test("enqueue is idempotent: the same key gives the same Job, claimed once", async () => {
  const { t, mac, jobId, thingsJob } = await setup();
  expect(await t.mutation(internal.platform.jobs.enqueue, { job: thingsJob, idempotencyKey: "things:1" })).toBe(jobId);
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toMatchObject({ jobId, attempts: 1 });
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
});

test("a Worker claims only the kinds it can do, and an unknown token is refused", async () => {
  const { t, server } = await setup();
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toBeNull();
  await expect(t.mutation(api.platform.jobs.claim, { token: "stolen" })).rejects.toThrow("This Worker token is not valid.");
});

test("an expired lease returns the Job to the queue, and the old holder can no longer finish it", async () => {
  const { t, mac, jobId } = await setup();
  const other = await registerWorker(t, "mac-mini", ["things"]);
  await t.mutation(api.platform.jobs.claim, { token: mac });
  vi.advanceTimersByTime(30_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: other })).toBeNull();
  vi.advanceTimersByTime(31_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: other })).toMatchObject({ jobId, attempts: 2 });
  expect(await t.mutation(api.platform.jobs.complete, { token: mac, jobId, receipt: null })).toEqual({
    ok: false,
    error: { kind: "not_claimed", jobId },
  });
  unwrap(await t.mutation(api.platform.jobs.complete, { token: other, jobId, receipt: { thingsId: "T1" } }));
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
});

test("a heartbeat keeps the lease alive", async () => {
  const { t, mac, jobId } = await setup();
  const other = await registerWorker(t, "mac-mini", ["things"]);
  await t.mutation(api.platform.jobs.claim, { token: mac });
  vi.advanceTimersByTime(50_000);
  unwrap(await t.mutation(api.platform.jobs.heartbeat, { token: mac, jobId }));
  vi.advanceTimersByTime(50_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: other })).toBeNull();
});

test("a failed Job retries after a backoff, then fails for good after its last attempt", async () => {
  const { t, mac, jobId } = await setup();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toMatchObject({ jobId, attempts: attempt });
    expect(unwrap(await t.mutation(api.platform.jobs.fail, { token: mac, jobId, error: "Things busy", retry: true }))).toEqual({
      retrying: true,
    });
    expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
    vi.advanceTimersByTime(5 * 60_000);
  }
  await t.mutation(api.platform.jobs.claim, { token: mac });
  expect(unwrap(await t.mutation(api.platform.jobs.fail, { token: mac, jobId, error: "Things busy", retry: true }))).toEqual({
    retrying: false,
  });
  vi.advanceTimersByTime(60 * 60_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({
    status: { kind: "failed", error: "Things busy" },
    attempts: 5,
  });
});

test("a Job whose lease keeps expiring fails after its last attempt", async () => {
  const { t, mac, jobId } = await setup();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toMatchObject({ jobId, attempts: attempt });
    vi.advanceTimersByTime(61_000);
  }
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({
    status: { kind: "failed", error: "lease_expired" },
  });
});

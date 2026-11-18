import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { newBackend, registerWorker, unwrap } from "../backend.test-utils";

const agentJob = { kind: "agent" as const, payload: { request: "Plan my thesis week" } };
const LEASE_MS = 15 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 18, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = async () => {
  const t = await newBackend();
  const server = await registerWorker(t, "home-server", ["agent"]);
  const jobId = await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:1" });
  return { t, server, jobId };
};

test("enqueue is idempotent: the same key gives the same Job, claimed once", async () => {
  const { t, server, jobId } = await setup();
  expect(await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:1" })).toBe(jobId);
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toMatchObject({ jobId, job: agentJob, attempts: 1 });
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toBeNull();
});

test("a Worker claims only Job kinds it can do: the things capability claims nothing, and an unknown token is refused", async () => {
  const { t, server, jobId } = await setup();
  const mac = await registerWorker(t, "mac", ["things"]);
  expect(await t.mutation(api.platform.jobs.claim, { token: mac })).toBeNull();
  await expect(t.mutation(api.platform.jobs.claim, { token: "stolen" })).rejects.toThrow("This Worker token is not valid.");
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toMatchObject({ jobId });
});

test("an expired lease fails the Job after its one attempt, and the old holder can no longer finish it", async () => {
  const { t, server, jobId } = await setup();
  const other = await registerWorker(t, "mac-mini", ["agent"]);
  await t.mutation(api.platform.jobs.claim, { token: server });
  vi.advanceTimersByTime(LEASE_MS - 60_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: other })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({ status: { kind: "claimed" } });
  vi.advanceTimersByTime(2 * 60_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: other })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({
    status: { kind: "failed", error: "lease_expired" },
    attempts: 1,
  });
  expect(await t.mutation(api.platform.jobs.complete, { token: server, jobId, attempt: 1, receipt: null })).toEqual({
    ok: false,
    error: { kind: "not_claimed", jobId },
  });
});

test("a heartbeat keeps the lease alive", async () => {
  const { t, server, jobId } = await setup();
  await t.mutation(api.platform.jobs.claim, { token: server });
  vi.advanceTimersByTime(LEASE_MS - 60_000);
  unwrap(await t.mutation(api.platform.jobs.heartbeat, { token: server, jobId, attempt: 1 }));
  vi.advanceTimersByTime(LEASE_MS - 60_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toBeNull();
  unwrap(await t.mutation(api.platform.jobs.complete, { token: server, jobId, attempt: 1, receipt: { summary: "Planned" } }));
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({
    status: { kind: "done", receipt: { summary: "Planned" } },
  });
});

test("an Agent Job gets one attempt: a failure is final even when the Worker asks to retry", async () => {
  const { t, server, jobId } = await setup();
  await t.mutation(api.platform.jobs.claim, { token: server });
  expect(
    unwrap(await t.mutation(api.platform.jobs.fail, { token: server, jobId, attempt: 1, error: "Model busy", retry: true })),
  ).toEqual({ retrying: false });
  vi.advanceTimersByTime(60 * 60_000);
  expect(await t.mutation(api.platform.jobs.claim, { token: server })).toBeNull();
  expect(await t.run((ctx) => ctx.db.get("jobs", jobId))).toMatchObject({
    status: { kind: "failed", error: "Model busy" },
    attempts: 1,
  });
});

test("only the Worker holding the Job can heartbeat, complete or fail it", async () => {
  const { t, server, jobId } = await setup();
  const other = await registerWorker(t, "mac-mini", ["agent"]);
  await t.mutation(api.platform.jobs.claim, { token: server });
  const refused = { ok: false, error: { kind: "not_claimed", jobId } };
  expect(await t.mutation(api.platform.jobs.heartbeat, { token: other, jobId, attempt: 1 })).toEqual(refused);
  expect(await t.mutation(api.platform.jobs.complete, { token: other, jobId, attempt: 1, receipt: null })).toEqual(refused);
  expect(await t.mutation(api.platform.jobs.fail, { token: other, jobId, attempt: 1, error: "no", retry: false })).toEqual(
    refused,
  );
  expect(await t.mutation(api.platform.jobs.complete, { token: server, jobId, attempt: 2, receipt: null })).toEqual(refused);
});

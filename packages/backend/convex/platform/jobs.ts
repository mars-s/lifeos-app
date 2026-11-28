import { v } from "convex/values";
import { Clock, Effect } from "effect";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { asWire } from "../../shared/result";
import { CurrentWorker, internalMutation, reading, workerMutation, writing } from "./effect";
import { NotClaimed } from "./errors";
import { vJob, type Capability, type Job, type JobKind } from "./tables";

export const jobKinds = {
  agent: { maxAttempts: 1, leaseMs: 15 * 60_000 },
} as const satisfies Record<JobKind, { maxAttempts: number; leaseMs: number }>;

const retryDelayMs = (attempts: number) => Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

export const enqueueJob = async (ctx: MutationCtx, job: Job, idempotencyKey: string) => {
  const existing = await ctx.db
    .query("jobs")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert("jobs", {
    job,
    idempotencyKey,
    status: { kind: "queued", availableAt: Date.now() },
    attempts: 0,
  });
};

export const enqueue = internalMutation({
  args: { job: vJob, idempotencyKey: v.string() },
  handler: ({ job, idempotencyKey }) => writing((ctx) => enqueueJob(ctx, job, idempotencyKey)),
});

const nextQueued = (ctx: MutationCtx, kind: JobKind, now: number) =>
  ctx.db
    .query("jobs")
    .withIndex("by_kind_status_available", (q) =>
      q.eq("job.kind", kind).eq("status.kind", "queued").lte("status.availableAt", now),
    )
    .first();

const nextExpired = (ctx: MutationCtx, kind: JobKind, now: number) =>
  ctx.db
    .query("jobs")
    .withIndex("by_kind_status_lease", (q) =>
      q.eq("job.kind", kind).eq("status.kind", "claimed").lt("status.leaseUntil", now),
    )
    .first();

const claimableOf = async (ctx: MutationCtx, kind: JobKind, now: number) => {
  const queued = await nextQueued(ctx, kind, now);
  if (queued) return queued;
  for (let expired = await nextExpired(ctx, kind, now); expired; expired = await nextExpired(ctx, kind, now)) {
    if (expired.attempts < jobKinds[kind].maxAttempts) return expired;
    await ctx.db.patch("jobs", expired._id, { status: { kind: "failed", at: now, error: "lease_expired" } });
  }
  return null;
};

const isJobKind = (capability: Capability): capability is JobKind => capability in jobKinds;

export const claim = workerMutation({
  args: {},
  handler: Effect.fn("jobs.claim")(function* () {
    const worker = yield* CurrentWorker;
    const now = yield* Clock.currentTimeMillis;
    for (const kind of worker.capabilities.filter(isJobKind)) {
      const job = yield* writing((ctx) => claimableOf(ctx, kind, now));
      if (!job) continue;
      const leaseUntil = now + jobKinds[kind].leaseMs;
      const attempts = job.attempts + 1;
      yield* writing((ctx) =>
        ctx.db.patch("jobs", job._id, {
          status: { kind: "claimed", workerId: worker._id, leaseUntil, heartbeatAt: now },
          attempts,
        }),
      );
      return { jobId: job._id, job: job.job, attempts, leaseUntil };
    }
    return null;
  }),
});

const heldBy = Effect.fn("jobs.heldBy")(function* (jobId: Id<"jobs">, attempt: number) {
  const worker = yield* CurrentWorker;
  const job = yield* reading((ctx) => ctx.db.get("jobs", jobId));
  if (job?.status.kind !== "claimed" || job.status.workerId !== worker._id || job.attempts !== attempt) {
    return yield* new NotClaimed({ jobId });
  }
  return { ...job, status: job.status };
});

export const heartbeat = workerMutation({
  args: { jobId: v.id("jobs"), attempt: v.number() },
  handler: Effect.fn("jobs.heartbeat")(function* ({ jobId, attempt }) {
    const job = yield* heldBy(jobId, attempt);
    const now = yield* Clock.currentTimeMillis;
    const leaseUntil = now + jobKinds[job.job.kind].leaseMs;
    yield* writing((ctx) => ctx.db.patch("jobs", jobId, { status: { ...job.status, leaseUntil, heartbeatAt: now } }));
    return { leaseUntil };
  }, asWire),
});

export const complete = workerMutation({
  args: { jobId: v.id("jobs"), attempt: v.number(), receipt: v.any() },
  handler: Effect.fn("jobs.complete")(function* ({ jobId, attempt, receipt }) {
    yield* heldBy(jobId, attempt);
    const at = yield* Clock.currentTimeMillis;
    yield* writing((ctx) => ctx.db.patch("jobs", jobId, { status: { kind: "done", at, receipt } }));
    return { jobId };
  }, asWire),
});

export const fail = workerMutation({
  args: { jobId: v.id("jobs"), attempt: v.number(), error: v.string(), retry: v.boolean() },
  handler: Effect.fn("jobs.fail")(function* ({ jobId, attempt, error, retry }) {
    const job = yield* heldBy(jobId, attempt);
    const now = yield* Clock.currentTimeMillis;
    const retrying = retry && job.attempts < jobKinds[job.job.kind].maxAttempts;
    yield* writing((ctx) =>
      ctx.db.patch("jobs", jobId, {
        status: retrying ? { kind: "queued", availableAt: now + retryDelayMs(job.attempts) } : { kind: "failed", at: now, error },
      }),
    );
    return { retrying };
  }, asWire),
});

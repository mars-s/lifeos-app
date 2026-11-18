import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { serialise } from "../../shared/result";
import { vJob, type Job, type JobKind } from "./tables";
import { workerForToken } from "./workers";

export const jobKinds = {
  things: { maxAttempts: 5, leaseMs: 60_000 },
  agent: { maxAttempts: 1, leaseMs: 15 * 60_000 },
} as const satisfies Record<JobKind, { maxAttempts: number; leaseMs: number }>;

const retryDelayMs = (attempts: number) => Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

export type JobError = { readonly kind: "not_claimed"; readonly jobId: Id<"jobs"> };

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
  handler: (ctx, { job, idempotencyKey }) => enqueueJob(ctx, job, idempotencyKey),
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

export const claim = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const worker = await workerForToken(ctx, token);
    const now = Date.now();
    for (const kind of worker.capabilities) {
      const job = await claimableOf(ctx, kind, now);
      if (!job) continue;
      const leaseUntil = now + jobKinds[kind].leaseMs;
      const attempts = job.attempts + 1;
      await ctx.db.patch("jobs", job._id, {
        status: { kind: "claimed", workerId: worker._id, leaseUntil, heartbeatAt: now },
        attempts,
      });
      return { jobId: job._id, job: job.job, attempts, leaseUntil };
    }
    return null;
  },
});

const heldBy = async (ctx: MutationCtx, token: string, jobId: Id<"jobs">) => {
  const worker = await workerForToken(ctx, token);
  const job = await ctx.db.get("jobs", jobId);
  const held = job?.status.kind === "claimed" && job.status.workerId === worker._id;
  return held ? ok<Doc<"jobs">, JobError>(job) : err<Doc<"jobs">, JobError>({ kind: "not_claimed", jobId });
};

export const heartbeat = mutation({
  args: { token: v.string(), jobId: v.id("jobs") },
  handler: async (ctx, { token, jobId }) =>
    serialise(
      await (await heldBy(ctx, token, jobId)).asyncMap(async (job) => {
        const now = Date.now();
        const leaseUntil = now + jobKinds[job.job.kind].leaseMs;
        if (job.status.kind === "claimed") {
          await ctx.db.patch("jobs", jobId, { status: { ...job.status, leaseUntil, heartbeatAt: now } });
        }
        return { leaseUntil };
      }),
    ),
});

export const complete = mutation({
  args: { token: v.string(), jobId: v.id("jobs"), receipt: v.any() },
  handler: async (ctx, { token, jobId, receipt }) =>
    serialise(
      await (await heldBy(ctx, token, jobId)).asyncMap(async () => {
        await ctx.db.patch("jobs", jobId, { status: { kind: "done", at: Date.now(), receipt } });
        return { jobId };
      }),
    ),
});

export const fail = mutation({
  args: { token: v.string(), jobId: v.id("jobs"), error: v.string(), retry: v.boolean() },
  handler: async (ctx, { token, jobId, error, retry }) =>
    serialise(
      await (await heldBy(ctx, token, jobId)).asyncMap(async (job) => {
        const now = Date.now();
        const retrying = retry && job.attempts < jobKinds[job.job.kind].maxAttempts;
        await ctx.db.patch("jobs", jobId, {
          status: retrying
            ? { kind: "queued", availableAt: now + retryDelayMs(job.attempts) }
            : { kind: "failed", at: now, error },
        });
        return { retrying };
      }),
    ),
});

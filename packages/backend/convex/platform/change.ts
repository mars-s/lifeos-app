import { ConvexError, v, type ObjectType, type PropertyValidators } from "convex/values";
import type { Result } from "neverthrow";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { serialise } from "../../shared/result";
import { startRecording, type Recorder } from "./activity";
import type { Actor } from "./tables";
import { workerForToken } from "./workers";

export const vAgentRunCredential = v.optional(v.object({ token: v.string(), jobId: v.id("jobs") }));

export const actorFor = async (ctx: MutationCtx, agentRun: { token: string; jobId: Id<"jobs"> } | undefined) => {
  if (!agentRun) return { kind: "avi" } satisfies Actor;
  const worker = await workerForToken(ctx, agentRun.token);
  const run = await ctx.db.get("jobs", agentRun.jobId);
  const active =
    run?.job.kind === "agent" && run.status.kind === "claimed" && run.status.workerId === worker._id;
  if (!active) throw new ConvexError("This Agent Run is not active.");
  return { kind: "agentRun", jobId: agentRun.jobId } satisfies Actor;
};

export const changeMutation = <Args extends PropertyValidators, T extends object, E>(spec: {
  action: string;
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, record: Recorder) => Promise<Result<T, E>>;
}) =>
  mutation({
    args: { ...spec.args, agentRun: vAgentRunCredential },
    handler: async (ctx, { agentRun, ...args }) => {
      const record = startRecording(ctx, await actorFor(ctx, agentRun), spec.action);
      const result = await spec.handler(ctx, args as ObjectType<Args>, record);
      const activityId = await record.finish();
      return serialise(result.map((value) => ({ ...value, activityId })));
    },
  });

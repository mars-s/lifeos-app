import { getAuthUserId } from "@convex-dev/auth/server";
import { vGithubProfile } from "@convex-dev/auth/methods/github/server";
import { ConvexError, v, type ObjectType, type PropertyValidators } from "convex/values";
import { env, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Actor } from "./tables";
import { workerForToken } from "./workers";

export type AccessRefusal = "signed_out" | "not_owner";
export type AccessError = { readonly kind: AccessRefusal; readonly message: string };

const refusalMessages = {
  signed_out: "Sign in to use LifeOS.",
  not_owner: "This is not your LifeOS. Only its owner can use it.",
} as const satisfies Record<AccessRefusal, string>;

const refuse = (kind: AccessRefusal) => new ConvexError<AccessError>({ kind, message: refusalMessages[kind] });

const isOwnerAccount = (githubId: string) => githubId === env.LIFEOS_OWNER_GITHUB_ID;

const callerOf = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return { kind: "signed_out" } as const;
  const user = await ctx.db.get("users", userId);
  return user && isOwnerAccount(user.githubId) ? ({ kind: "owner", userId } as const) : ({ kind: "not_owner" } as const);
};

const requireOwner = async (ctx: QueryCtx) => {
  const caller = await callerOf(ctx);
  if (caller.kind !== "owner") throw refuse(caller.kind);
  return caller.userId;
};

export const vAgentRunCredential = v.optional(v.object({ token: v.string(), jobId: v.id("jobs") }));

const actorFor = async (ctx: MutationCtx, agentRun: { token: string; jobId: Id<"jobs"> } | undefined) => {
  if (!agentRun) {
    await requireOwner(ctx);
    return { kind: "avi" } satisfies Actor;
  }
  const worker = await workerForToken(ctx, agentRun.token);
  const run = await ctx.db.get("jobs", agentRun.jobId);
  const active =
    run?.job.kind === "agent" &&
    run.status.kind === "claimed" &&
    run.status.workerId === worker._id &&
    run.status.leaseUntil >= Date.now();
  if (!active) throw new ConvexError("This Agent Run is not active.");
  return { kind: "agentRun", jobId: agentRun.jobId } satisfies Actor;
};

export const ownerQuery = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Output>;
}) =>
  query({
    args: spec.args,
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      await requireOwner(ctx);
      return spec.handler(ctx, args);
    },
  });

export const ownerMutation = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, actor: Actor) => Promise<Output>;
}) =>
  mutation({
    args: { ...spec.args, agentRun: vAgentRunCredential },
    handler: async (ctx, { agentRun, ...args }) =>
      spec.handler(ctx, args as ObjectType<Args>, await actorFor(ctx, agentRun)),
  });

export const workerMutation = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, worker: Doc<"workers">) => Promise<Output>;
}) =>
  mutation({
    args: { ...spec.args, token: v.string() },
    handler: async (ctx, { token, ...args }) =>
      spec.handler(ctx, args as ObjectType<Args>, await workerForToken(ctx, token)),
  });

export const isOwner = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await callerOf(ctx)).kind === "owner",
});

const vGithubSignIn = v.object({ name: v.literal("github"), profile: vGithubProfile });

export const createUser = internalMutation({
  args: { method: vGithubSignIn },
  returns: v.id("users"),
  handler: (ctx, { method: { profile } }) => ctx.db.insert("users", { githubId: profile.id, login: profile.login }),
});

export const onSignIn = internalMutation({
  args: { method: vGithubSignIn, userId: v.id("users") },
  returns: v.null(),
  handler: async (_ctx, { method: { profile } }) => {
    if (!isOwnerAccount(profile.id)) throw refuse("not_owner");
    return null;
  },
});

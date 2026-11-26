import { getAuthUserId } from "@convex-dev/auth/server";
import { vGithubProfile } from "@convex-dev/auth/methods/github/server";
import { vMcpUser } from "@convex-dev/mcp";
import { ConvexError, v, type Infer, type ObjectType, type PropertyValidators } from "convex/values";
import { makeFunctionReference, type DefaultFunctionArgs, type RegisteredQuery } from "convex/server";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Actor } from "./tables";
import { workerForToken } from "./workers";
import { runActor } from "./agentRuns";

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

const ownerReads = new WeakMap<object, (ctx: QueryCtx, args: never) => Promise<unknown>>();

export const ownerQuery = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Output>;
}) => {
  const registered = query({
    args: spec.args,
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      await requireOwner(ctx);
      return spec.handler(ctx, args);
    },
  });
  ownerReads.set(registered, spec.handler);
  return registered;
};

export const readAsOwner = async <Args extends DefaultFunctionArgs, Output>(
  ctx: QueryCtx,
  registered: RegisteredQuery<"public", Args, Promise<Output>>,
  args: Args,
) => {
  const read = ownerReads.get(registered);
  if (!read) throw new Error("readAsOwner needs a query built with ownerQuery.");
  return (await read(ctx, args as never)) as Output;
};

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

const callerKindQuery = makeFunctionReference<"query", Record<string, never>, "owner" | AccessRefusal>("platform/access:callerKind");

export const ownerAction = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: ActionCtx, args: ObjectType<Args>) => Promise<Output>;
}) =>
  action({
    args: spec.args,
    handler: async (ctx: ActionCtx, args: ObjectType<Args>) => {
      const kind = await ctx.runQuery(callerKindQuery, {});
      if (kind !== "owner") throw refuse(kind);
      return spec.handler(ctx, args);
    },
  });

const workerForTokenQuery = makeFunctionReference<"query", { token: string }, Doc<"workers">>("platform/workers:forToken");

export const workerAction = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: ActionCtx, args: ObjectType<Args>, worker: Doc<"workers">) => Promise<Output>;
}) =>
  action({
    args: { ...spec.args, token: v.string() },
    handler: async (ctx, { token, ...args }) =>
      spec.handler(ctx, args as ObjectType<Args>, await ctx.runQuery(workerForTokenQuery, { token })),
  });

export const account = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.get("users", await requireOwner(ctx));
    return { login: user?.login ?? null };
  },
});

export const callerKind = internalQuery({
  args: {},
  handler: async (ctx) => (await callerOf(ctx)).kind,
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

export const MCP_SCOPES = { read: "lifeos:read", write: "lifeos:write" } as const;

export const mcpOwnerUserId = () => process.env.LIFEOS_OWNER_USER_ID ?? "owner";

export const vAgentCaller = vMcpUser();

export type AgentCaller = Infer<typeof vAgentCaller>;

export type AgentRunActor = Extract<Actor, { kind: "agentRun" }>;

const requireOwnerConnection = (caller: AgentCaller) => {
  if (caller.userId !== mcpOwnerUserId()) throw new ConvexError("This LifeOS belongs to someone else.");
};

export const agentQuery = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Output>;
}) =>
  internalQuery({
    args: { ...spec.args, caller: vAgentCaller },
    handler: async (ctx, { caller, ...args }) => {
      requireOwnerConnection(caller);
      return spec.handler(ctx, args as ObjectType<Args>);
    },
  });

export const agentMutation = <Args extends PropertyValidators, Output>(spec: {
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, run: () => Promise<AgentRunActor>, caller: AgentCaller) => Promise<Output>;
}) =>
  internalMutation({
    args: { ...spec.args, caller: vAgentCaller },
    handler: async (ctx, { caller, ...args }) => {
      requireOwnerConnection(caller);
      if (!caller.scopes.includes(MCP_SCOPES.write)) {
        throw new ConvexError("This connection can only read. Reconnect LifeOS with the lifeos:write scope to make changes.");
      }
      let actor: Promise<AgentRunActor> | undefined;
      const run = () => (actor ??= runActor(ctx, caller));
      return spec.handler(ctx, args as ObjectType<Args>, run, caller);
    },
  });

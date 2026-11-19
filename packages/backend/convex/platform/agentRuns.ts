import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AgentCaller } from "./access";
import { sha256Hex } from "./workers";

export const MCP_RUN_IDLE_MS = 10 * 60_000;
export const MCP_WORKER_NAME = "mcp";

const runKeyPrefix = (connectionId: string) => `mcp:${connectionId}:`;

export const latestMcpRun = (ctx: QueryCtx, connectionId: string) => {
  const prefix = runKeyPrefix(connectionId);
  return ctx.db
    .query("jobs")
    .withIndex("by_idempotency_key", (q) => q.gte("idempotencyKey", prefix).lt("idempotencyKey", `${prefix}￿`))
    .order("desc")
    .first();
};

export const isRunOf = (run: Doc<"jobs"> | null, connectionId: string) =>
  run !== null && run.idempotencyKey.startsWith(runKeyPrefix(connectionId));

export const isLiveRun = (run: Doc<"jobs">, now: number) => run.status.kind === "claimed" && run.status.leaseUntil >= now;

const mcpWorker = async (ctx: MutationCtx) => {
  const existing = await ctx.db
    .query("workers")
    .withIndex("by_name", (q) => q.eq("name", MCP_WORKER_NAME))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert("workers", {
    name: MCP_WORKER_NAME,
    capabilities: [],
    tokenHash: await sha256Hex(crypto.randomUUID()),
  });
};

const connectionName = async (ctx: MutationCtx, caller: AgentCaller) => {
  const grants = await ctx.runQuery(components.mcp.grants.list, { userId: caller.userId });
  return grants.find((grant) => grant._id === caller.connectionId)?.name ?? caller.clientId ?? "An agent";
};

export const endMcpRun = async (ctx: MutationCtx, run: Doc<"jobs">, now: number) => {
  if (run.status.kind !== "claimed") return;
  await ctx.db.patch("jobs", run._id, {
    status: { kind: "done", at: Math.min(now, run.status.leaseUntil), receipt: { endedBy: "mcp" } },
  });
};

export const mcpRunActor = async (ctx: MutationCtx, caller: AgentCaller) => {
  const now = Date.now();
  const latest = await latestMcpRun(ctx, caller.connectionId);
  if (latest && isLiveRun(latest, now) && latest.status.kind === "claimed") {
    await ctx.db.patch("jobs", latest._id, { status: { ...latest.status, leaseUntil: now + MCP_RUN_IDLE_MS, heartbeatAt: now } });
    return { kind: "agentRun", jobId: latest._id } as const;
  }
  if (latest) await endMcpRun(ctx, latest, now);
  const jobId: Id<"jobs"> = await ctx.db.insert("jobs", {
    job: { kind: "agent", payload: { request: `${await connectionName(ctx, caller)} over MCP` } },
    idempotencyKey: `${runKeyPrefix(caller.connectionId)}${now}`,
    status: { kind: "claimed", workerId: await mcpWorker(ctx), leaseUntil: now + MCP_RUN_IDLE_MS, heartbeatAt: now },
    attempts: 1,
  });
  return { kind: "agentRun", jobId } as const;
};

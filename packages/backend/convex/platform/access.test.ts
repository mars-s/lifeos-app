import { expect, test } from "vitest";
import { sessionIdentity } from "@convex-dev/auth/test";
import { api, components, internal } from "../_generated/api";
import {
  newSignedOutBackend,
  ownerGithubId,
  registerWorker,
  signInWithGithub,
  unwrap,
  type SignedOutBackend,
} from "../backend.test-utils";
import { rowsOf, thingsItem } from "../planner/things.test-utils";

const signedOut = { kind: "signed_out", message: "Sign in to use LifeOS." };
const notOwner = { kind: "not_owner", message: "This is not your LifeOS. Only its owner can use it." };

const refusal = async (call: Promise<unknown>) => {
  const error: unknown = await call.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  return error && typeof error === "object" && "data" in error ? error.data : error;
};

const strangerSession = async (t: SignedOutBackend) => {
  const userId = await t.run((ctx) => ctx.db.insert("users", { githubId: "2002", login: "stranger" }));
  const tokens = await t.run(async (ctx) =>
    ctx.runMutation(components.auth.public._internal_dangerous_signIn, {
      claims: { method: "github", profile: { id: "2002", login: "stranger", emailVerified: false } },
      componentPath: "authGithub",
      userId,
      accessTokenTtlSeconds: 60,
      refreshInactivityTimeoutSeconds: 3600,
      sessionMaxLifetimeSeconds: 3600,
    }),
  );
  return t.withIdentity(sessionIdentity(tokens));
};

const ownerWork = async () => {
  const anonymous = newSignedOutBackend();
  const owner = await signInWithGithub(anonymous, ownerGithubId, "avi");
  const { taskId, activityId } = unwrap(await owner.mutation(api.planner.tasks.create, { title: "Draft intro" }));
  if (!activityId) throw new Error("Creating a Task records Activity.");
  return { anonymous, owner, taskId, activityId };
};

test("signed out, every kind of public function refuses with a clear signed_out error", async () => {
  const { anonymous, owner, taskId, activityId } = await ownerWork();
  expect(await refusal(anonymous.query(api.planner.today.get, { date: "2026-11-18" }))).toEqual(signedOut);
  expect(await refusal(anonymous.query(api.planner.tasks.card, { taskId }))).toEqual(signedOut);
  expect(await refusal(anonymous.mutation(api.planner.tasks.create, { title: "Sneaky" }))).toEqual(signedOut);
  expect(await refusal(anonymous.mutation(api.planner.tasks.rename, { taskId, title: "Sneaky" }))).toEqual(signedOut);
  expect(await refusal(anonymous.mutation(api.platform.undo.undo, { activityId }))).toEqual(signedOut);
  expect((await owner.query(api.planner.tasks.card, { taskId }))?.title).toBe("Draft intro");
});

test("a GitHub account that is not the owner cannot sign in", async () => {
  const t = newSignedOutBackend();
  expect(await refusal(signInWithGithub(t, "2002", "stranger"))).toEqual(notOwner);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
});

test("a session that is not the owner's is refused by queries, the change builder and undo", async () => {
  const { anonymous, owner, taskId, activityId } = await ownerWork();
  const stranger = await strangerSession(anonymous);
  expect(await refusal(stranger.query(api.planner.today.get, { date: "2026-11-18" }))).toEqual(notOwner);
  expect(await refusal(stranger.mutation(api.planner.tasks.rename, { taskId, title: "Mine now" }))).toEqual(notOwner);
  expect(await refusal(stranger.mutation(api.platform.undo.undo, { activityId }))).toEqual(notOwner);
  expect((await owner.query(api.planner.tasks.card, { taskId }))?.title).toBe("Draft intro");
});

test("the owner reads, changes and undoes", async () => {
  const { owner, taskId, activityId } = await ownerWork();
  expect(unwrap(await owner.query(api.planner.today.get, { date: "2026-11-18" })).tasks).toEqual([]);
  unwrap(await owner.mutation(api.planner.tasks.rename, { taskId, title: "Draft the introduction" }));
  expect((await owner.query(api.planner.tasks.card, { taskId }))?.title).toBe("Draft the introduction");
  const latest = await owner.run((ctx) => ctx.db.query("activity").order("desc").first());
  unwrap(await owner.mutation(api.platform.undo.undo, { activityId: latest!._id }));
  expect((await owner.query(api.planner.tasks.card, { taskId }))?.title).toBe("Draft intro");
  expect(await refusal(owner.mutation(api.platform.undo.undo, { activityId }))).toBeNull();
});

test("Workers keep their own token auth with no signed-in identity", async () => {
  const { anonymous: worker, owner } = await ownerWork();
  const thingsToken = await registerWorker(owner, "things", ["things"]);
  const agentToken = await registerWorker(owner, "home-server", ["agent"]);
  const imported = unwrap(
    await worker.action(api.planner.things.importRows, { token: thingsToken, rows: rowsOf({ items: [thingsItem("T1", "Walk")] }) }),
  );
  expect(imported.tasks).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
  await owner.mutation(internal.platform.jobs.enqueue, {
    job: { kind: "agent", payload: { request: "Plan my week" } },
    idempotencyKey: "agent:plan-week",
  });
  const claimed = await worker.mutation(api.platform.jobs.claim, { token: agentToken });
  const agentRun = { token: agentToken, jobId: claimed!.jobId };
  const { taskId } = unwrap(await worker.mutation(api.planner.tasks.create, { title: "Agent task", agentRun }));
  expect((await owner.query(api.planner.tasks.card, { taskId }))?.title).toBe("Agent task");
  expect(await refusal(worker.action(api.planner.things.importRows, { token: agentToken, rows: rowsOf({}) }))).toBe(
    "This Worker cannot do things work.",
  );
  expect(await refusal(worker.mutation(api.platform.jobs.claim, { token: "forged" }))).toBe(
    "This Worker token is not valid.",
  );
});

test("the MCP connector acts only for the owner's Convex Auth identity", async () => {
  const { anonymous, owner } = await ownerWork();
  const stranger = await strangerSession(anonymous);
  const { apiKey } = await owner.action(api.mcp.createApiKey, { name: "Claude Code" });
  expect(apiKey).toEqual(expect.any(String));
  expect(await owner.query(api.mcp.listConnections, {})).toHaveLength(1);
  expect(await stranger.query(api.mcp.listConnections, {})).toEqual([]);
  expect(await refusal(stranger.action(api.mcp.createApiKey, { name: "Stolen" }))).toBe("Not signed in");
  expect(await refusal(anonymous.action(api.mcp.createApiKey, { name: "Anonymous" }))).toBe("Not signed in");
});

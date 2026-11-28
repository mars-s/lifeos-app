import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { PROVIDERS } from "../../shared/ai";
import { newBackend, registerWorker, unwrap, type Backend } from "../backend.test-utils";

const NOW = Date.UTC(2026, 10, 29, 9, 0);
const LEASE_MS = 15 * 60_000;
const agentJob = { kind: "agent" as const, payload: { request: "Plan my thesis week" } };

const SEALING_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const GOOD_KEY = "sk-proj-goodkey-wxyz";

const provider = setupServer();

beforeAll(() => provider.listen({ onUnhandledRequest: "error" }));
afterAll(() => provider.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("OPENAI_API_KEY", undefined);
  vi.stubEnv("OPENCODE_GO_API_KEY", undefined);
});

afterEach(() => {
  provider.resetHandlers();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const startAgentRun = async (t: Backend) => {
  const token = await registerWorker(t, "home-server", ["agent"]);
  const jobId = await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:wire" });
  const claimed = await t.mutation(api.platform.jobs.claim, { token });
  return { token, jobId, attempt: claimed!.attempts };
};

const leaseOf = (t: Backend, jobId: Id<"jobs">) =>
  t.run(async (ctx) => {
    const job = await ctx.db.get("jobs", jobId);
    return job?.status.kind === "claimed" ? job.status.leaseUntil : Number.NaN;
  });

const undoOf = (t: Backend, activityId: Id<"activity">) =>
  t.run(async (ctx) =>
    (await ctx.db
      .query("activity")
      .withIndex("by_undoes_activity", (q) => q.eq("undoes.activityId", activityId))
      .unique())!._id,
  );

const undoOfRun = (t: Backend, jobId: Id<"jobs">) =>
  t.run(async (ctx) =>
    (await ctx.db
      .query("activity")
      .withIndex("by_undoes_run", (q) => q.eq("undoes.jobId", jobId))
      .unique())!._id,
  );

const goneActivity = (t: Backend) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("activity", { actor: { kind: "avi" }, action: "test.gone", at: NOW });
    await ctx.db.delete("activity", id);
    return id;
  });

const pastActivity = (t: Backend, actor: { kind: "things" } | { kind: "recurrence" } | { kind: "avi" }, action: string) =>
  t.run((ctx) => ctx.db.insert("activity", { actor, action, at: NOW }));

const addArea = (t: Backend, title: string) => t.run((ctx) => ctx.db.insert("areas", { title, colour: "teal", order: "a0" }));

const goneArea = (t: Backend) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("areas", { title: "Gone", colour: "teal", order: "a0" });
    await ctx.db.delete("areas", id);
    return id;
  });

describe("undo on the wire", () => {
  test("undo answers with the undo's Activity, and every refusal kind keeps its shape", async () => {
    const t = await newBackend();
    const on = unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "templates", enabled: false }));
    const undone = await t.mutation(api.platform.undo.undo, { activityId: on.activityId! });
    const undoActivityId = await undoOf(t, on.activityId!);
    expect(undone).toStrictEqual({ ok: true, value: { undoActivityId } });

    expect(await t.mutation(api.platform.undo.undo, { activityId: on.activityId! })).toStrictEqual({
      ok: false,
      error: { kind: "already_undone" },
    });
    expect(await t.mutation(api.platform.undo.undo, { activityId: undoActivityId })).toStrictEqual({
      ok: false,
      error: { kind: "not_undoable", reason: "undo" },
    });
    expect(await t.mutation(api.platform.undo.undo, { activityId: await goneActivity(t) })).toStrictEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await t.mutation(api.platform.undo.undo, { activityId: await pastActivity(t, { kind: "things" }, "things.import") })).toStrictEqual({
      ok: false,
      error: { kind: "not_undoable", reason: "things" },
    });
    expect(
      await t.mutation(api.platform.undo.undo, { activityId: await pastActivity(t, { kind: "recurrence" }, "recurrence.generate") }),
    ).toStrictEqual({ ok: false, error: { kind: "not_undoable", reason: "recurrence" } });
    expect(await t.mutation(api.platform.undo.undo, { activityId: await pastActivity(t, { kind: "avi" }, "trash.delete") })).toStrictEqual({
      ok: false,
      error: { kind: "not_undoable", reason: "permanent" },
    });
  });

  test("an undo blocked by a later change names the record it would overwrite", async () => {
    const t = await newBackend();
    const first = unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: false }));
    const row = await t.run(async (ctx) => (await ctx.db.query("features").unique())!._id);
    expect(await t.mutation(api.platform.undo.undo, { activityId: first.activityId! })).toStrictEqual({
      ok: false,
      error: { kind: "changed_since", entity: { table: "features", id: row } },
    });
  });

  test("undoRun answers with the undo's Activity, and refuses a live, empty or undone run", async () => {
    const t = await newBackend();
    const { token, jobId, attempt } = await startAgentRun(t);
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "templates", enabled: false, agentRun: { token, jobId } }));
    expect(await t.mutation(api.platform.undo.undoRun, { jobId })).toStrictEqual({ ok: false, error: { kind: "run_active" } });
    unwrap(await t.mutation(api.platform.jobs.complete, { token, jobId, attempt, receipt: null }));
    const undone = await t.mutation(api.platform.undo.undoRun, { jobId });
    expect(undone).toStrictEqual({ ok: true, value: { undoActivityId: await undoOfRun(t, jobId) } });
    expect(await t.mutation(api.platform.undo.undoRun, { jobId })).toStrictEqual({ ok: false, error: { kind: "already_undone" } });

    const empty = await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:empty" });
    const claimed = await t.mutation(api.platform.jobs.claim, { token });
    unwrap(await t.mutation(api.platform.jobs.complete, { token, jobId: empty, attempt: claimed!.attempts, receipt: null }));
    expect(await t.mutation(api.platform.undo.undoRun, { jobId: empty })).toStrictEqual({ ok: false, error: { kind: "nothing_to_undo" } });
  });
});

describe("Jobs on the wire", () => {
  test("claim answers with the Job and its lease, or null when there is nothing to do", async () => {
    const t = await newBackend();
    const token = await registerWorker(t, "home-server", ["agent"]);
    const jobId = await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:1" });
    const claimed = await t.mutation(api.platform.jobs.claim, { token });
    const leaseUntil = await leaseOf(t, jobId);
    expect(leaseUntil).toBeGreaterThanOrEqual(NOW + LEASE_MS);
    expect(claimed).toStrictEqual({ jobId, job: agentJob, attempts: 1, leaseUntil });
    expect(await t.mutation(api.platform.jobs.claim, { token })).toBeNull();
  });

  test("heartbeat, complete and fail answer in their shapes, and refuse a Worker that does not hold the Job", async () => {
    const t = await newBackend();
    const { token, jobId } = await startAgentRun(t);
    const other = await registerWorker(t, "mac-mini", ["agent"]);
    const refused = { ok: false, error: { kind: "not_claimed", jobId } };
    expect(await t.mutation(api.platform.jobs.heartbeat, { token: other, jobId, attempt: 1 })).toStrictEqual(refused);
    expect(await t.mutation(api.platform.jobs.complete, { token: other, jobId, attempt: 1, receipt: null })).toStrictEqual(refused);
    expect(await t.mutation(api.platform.jobs.fail, { token: other, jobId, attempt: 1, error: "no", retry: false })).toStrictEqual(refused);

    vi.advanceTimersByTime(60_000);
    const beat = await t.mutation(api.platform.jobs.heartbeat, { token, jobId, attempt: 1 });
    expect(beat).toStrictEqual({ ok: true, value: { leaseUntil: await leaseOf(t, jobId) } });
    expect(await t.mutation(api.platform.jobs.fail, { token, jobId, attempt: 1, error: "Model busy", retry: true })).toStrictEqual({
      ok: true,
      value: { retrying: false },
    });

    const next = await t.mutation(internal.platform.jobs.enqueue, { job: agentJob, idempotencyKey: "agent:2" });
    await t.mutation(api.platform.jobs.claim, { token });
    expect(await t.mutation(api.platform.jobs.complete, { token, jobId: next, attempt: 1, receipt: { summary: "Planned" } })).toStrictEqual({
      ok: true,
      value: { jobId: next },
    });
  });
});

const answering = (reply: (authorization: string | null) => Response) =>
  provider.resetHandlers(http.get(PROVIDERS.openai.keyCheckUrl, ({ request }) => reply(request.headers.get("authorization"))));

describe("secrets on the wire", () => {
  test("save answers with the last four characters and the time, and status and available read it back", async () => {
    vi.stubEnv("LIFEOS_SECRETS_KEY", SEALING_KEY);
    const t = await newBackend();
    answering((authorization) =>
      authorization === `Bearer ${GOOD_KEY}` ? HttpResponse.json({ object: "list", data: [] }) : HttpResponse.json({}, { status: 401 }),
    );
    expect(await t.query(api.platform.secrets.status, { name: "openai" })).toBeNull();
    expect(await t.query(api.platform.secrets.available, { name: "openai" })).toBe(false);
    const saved = await t.action(api.platform.secrets.save, { name: "openai", value: ` ${GOOD_KEY} ` });
    const savedAt = await t.run(async (ctx) => (await ctx.db.query("secrets").unique())!.savedAt);
    expect(savedAt).toBeGreaterThanOrEqual(NOW);
    expect(saved).toStrictEqual({ ok: true, value: { last4: "wxyz", savedAt } });
    expect(await t.query(api.platform.secrets.status, { name: "openai" })).toStrictEqual({ last4: "wxyz", savedAt });
    expect(await t.query(api.platform.secrets.available, { name: "openai" })).toBe(true);
    expect(await t.action(api.platform.secrets.remove, { name: "openai" })).toBeNull();
    expect(await t.query(api.platform.secrets.status, { name: "openai" })).toBeNull();
  });

  test("every refusal from save keeps its kind and fields", async () => {
    vi.stubEnv("LIFEOS_SECRETS_KEY", SEALING_KEY);
    const t = await newBackend();
    const save = (value: string) => t.action(api.platform.secrets.save, { name: "openai", value });

    expect(await save("   ")).toStrictEqual({ ok: false, error: { kind: "empty" } });
    answering(() => HttpResponse.json({ error: { code: "invalid_api_key" } }, { status: 401 }));
    expect(await save("sk-wrong")).toStrictEqual({ ok: false, error: { kind: "refused" } });
    answering(() => HttpResponse.json({}, { status: 403 }));
    expect(await save("sk-forbidden")).toStrictEqual({ ok: false, error: { kind: "refused" } });
    answering(() => HttpResponse.json({}, { status: 503 }));
    expect(await save("sk-busy")).toStrictEqual({ ok: false, error: { kind: "unavailable", status: 503 } });
    answering(() => HttpResponse.error());
    expect(await save("sk-offline")).toStrictEqual({ ok: false, error: { kind: "unreachable" } });

    vi.stubEnv("LIFEOS_SECRETS_KEY", undefined);
    expect(await save(GOOD_KEY)).toStrictEqual({ ok: false, error: { kind: "not_set_up" } });
    vi.stubEnv("LIFEOS_SECRETS_KEY", btoa("too short"));
    expect(await save(GOOD_KEY)).toStrictEqual({ ok: false, error: { kind: "not_set_up" } });
    vi.stubEnv("LIFEOS_SECRETS_KEY", "not base64 at all!");
    expect(await save(GOOD_KEY)).toStrictEqual({ ok: false, error: { kind: "not_set_up" } });
  });
});

describe("Features on the wire", () => {
  test("list answers with every Feature's switch, settings and status", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const t = await newBackend();
    expect(await t.query(api.platform.features.list, {})).toStrictEqual([
      { feature: "ai", enabled: false, settings: { routes: {} }, status: { kind: "off" } },
      { feature: "places", enabled: false, settings: { travelMode: "drive" }, status: { kind: "off" } },
      { feature: "templates", enabled: true, settings: {}, status: { kind: "ready" } },
      { feature: "smartBlocks", enabled: true, settings: { areaOrder: [] }, status: { kind: "ready" } },
    ]);
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "ai", enabled: true }));
    expect(await t.query(api.platform.features.list, {})).toStrictEqual([
      { feature: "ai", enabled: true, settings: { routes: {} }, status: { kind: "ready" } },
      { feature: "places", enabled: true, settings: { travelMode: "drive" }, status: { kind: "needs_setup", setup: "home" } },
      { feature: "templates", enabled: true, settings: {}, status: { kind: "ready" } },
      { feature: "smartBlocks", enabled: true, settings: { areaOrder: [] }, status: { kind: "ready" } },
    ]);
  });

  test("setEnabled and configure answer with changed and the Activity, or null when nothing changed", async () => {
    const t = await newBackend();
    const on = await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true });
    const activityId = await t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())!._id);
    expect(on).toStrictEqual({ ok: true, value: { changed: true, activityId } });
    expect(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true })).toStrictEqual({
      ok: true,
      value: { changed: false, activityId: null },
    });
    const walk = await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } });
    const walkId = await t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())!._id);
    expect(walk).toStrictEqual({ ok: true, value: { changed: true, activityId: walkId } });
    expect(await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } })).toStrictEqual({
      ok: true,
      value: { changed: false, activityId: null },
    });
  });
});

describe("entity links on the wire", () => {
  test("link, unlink and backlinks answer in their shapes, and a missing end is refused by name", async () => {
    const t = await newBackend();
    const from = { table: "areas" as const, id: await addArea(t, "Uni") };
    const to = { table: "areas" as const, id: await addArea(t, "Home") };
    const linked = await t.mutation(api.platform.links.link, { from, to });
    const linkId = await t.run(async (ctx) => (await ctx.db.query("entityLinks").unique())!._id);
    const linkActivity = await t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())!._id);
    expect(linked).toStrictEqual({ ok: true, value: { linkId, activityId: linkActivity } });
    expect(await t.query(api.platform.links.backlinks, { to })).toStrictEqual([{ linkId, from }]);

    const gone = { table: "areas" as const, id: await goneArea(t) };
    expect(await t.mutation(api.platform.links.link, { from, to: gone })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", entity: gone },
    });

    const unlinked = await t.mutation(api.platform.links.unlink, { linkId });
    const unlinkActivity = await t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())!._id);
    expect(unlinked).toStrictEqual({ ok: true, value: { activityId: unlinkActivity } });
    expect(await t.mutation(api.platform.links.unlink, { linkId })).toStrictEqual({ ok: true, value: { activityId: null } });
    expect(await t.query(api.platform.links.backlinks, { to })).toStrictEqual([]);
  });
});

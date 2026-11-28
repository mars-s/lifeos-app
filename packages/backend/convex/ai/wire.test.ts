import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { GO_CHAT_URL, newBackend, OPENAI_CHAT_URL, switchAiOn, unwrap, type Backend } from "../backend.test-utils";

const NOW = Date.UTC(2026, 10, 29, 9, 0);

type Reply = { text?: string; calls?: { name: string; input: Record<string, unknown> }[] } | { status: number };

const server = setupServer();
const replies: Reply[] = [];

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-wire", object: "chat.completion.chunk", created: 0, model: "served", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const sse = (reply: Exclude<Reply, { status: number }>) => {
  const calls = reply.calls ?? [];
  const body = [
    ...(reply.text ? [chunk({ role: "assistant", content: reply.text })] : []),
    ...calls.map((call, index) =>
      chunk({ role: "assistant", tool_calls: [{ index, id: `call_${call.name}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } }] }),
    ),
    chunk({}, calls.length > 0 ? "tool_calls" : "stop"),
    `data: ${JSON.stringify({ id: "chatcmpl-wire", object: "chat.completion.chunk", created: 0, model: "served", choices: [], usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } });
};

const stepsReply = (content: unknown) =>
  HttpResponse.json({ model: "served", choices: [{ message: { role: "assistant", content: JSON.stringify(content), refusal: null } }] });

const chatAnswer = async ({ request }: { request: Request }) => {
  const body = (await request.json()) as { stream?: boolean; response_format?: { json_schema?: { name: string } } };
  if (body.response_format?.json_schema?.name === "steps") return stepsReply({ steps: ["Draft the outline", "Write the body"], project: false });
  const reply = replies.shift();
  if (!reply) return HttpResponse.json({ error: { message: "No reply queued" } }, { status: 500 });
  return "status" in reply ? HttpResponse.json({ error: { message: "refused" } }, { status: reply.status }) : sse(reply);
};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("OPENAI_API_KEY", "sk-wire");
  vi.stubEnv("OPENCODE_GO_API_KEY", undefined);
  replies.length = 0;
  server.resetHandlers(http.post(OPENAI_CHAT_URL, chatAnswer), http.post(GO_CHAT_URL, chatAnswer));
});

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const aiBackend = async () => {
  const t = await newBackend();
  await switchAiOn(t, { smartEstimates: { on: false, model: "openai/decisions/gpt-6-luna" }, breakIntoSteps: { on: true, model: "openai/gpt-6-luna" } });
  return t;
};

const latestActivity = (t: Backend) => t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())!._id);

const addTask = (t: Backend, title: string) =>
  t.run((ctx) =>
    ctx.db.insert("tasks", { title, notes: "", when: { kind: "anytime" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "a0" }),
  );

const goneTask = (t: Backend) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("tasks", { title: "Gone", notes: "", when: { kind: "anytime" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "a0" });
    await ctx.db.delete("tasks", id);
    return id;
  });

const runStep = async (t: Backend, args: { jobId: Id<"jobs">; promptMessageId: string }) => {
  const step = { finished: false };
  const running = t.action(internal.ai.runs.step, args).finally(() => {
    step.finished = true;
  });
  while (!step.finished) await vi.advanceTimersByTimeAsync(5);
  await running;
};

const settleRuns = async (t: Backend) => {
  for (;;) {
    const pending = await t.run(async (ctx) => {
      const steps = (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.state.kind === "pending");
      for (const job of steps) await ctx.scheduler.cancel(job._id);
      return steps.filter((job) => job.name === "ai/runs:step").map((job) => job.args[0] as { jobId: Id<"jobs">; promptMessageId: string });
    });
    if (pending.length === 0) return;
    for (const args of pending) await runStep(t, args);
  }
};

const settleSteps = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

const jobOf = (t: Backend, jobId: Id<"jobs">) => t.run(async (ctx) => (await ctx.db.get("jobs", jobId))!);

describe("routing on the wire", () => {
  test("overview answers with the keyed Providers, the ask first switch and every capability", async () => {
    const t = await aiBackend();
    expect(await t.query(api.ai.routing.overview, {})).toStrictEqual({
      keyed: ["openai"],
      askFirst: false,
      capabilities: [
        { capability: "smartEstimates", on: false, model: "openai/decisions/gpt-6-luna", answering: "openai/decisions/gpt-6-luna" },
        { capability: "breakIntoSteps", on: true, model: "openai/gpt-6-luna", answering: "openai/gpt-6-luna" },
        { capability: "tripDetection", on: false, model: "openai/decisions/gpt-6-luna", answering: "openai/decisions/gpt-6-luna" },
        { capability: "agent", on: true, model: "openai/gpt-6-luna", answering: "openai/gpt-6-luna" },
        { capability: "searchIndex", on: true, model: "openai/text-embedding-3-small", answering: "openai/text-embedding-3-small" },
      ],
    });
  });

  test("setRoute and setAskFirst answer with changed and the Activity, and every refusal keeps its shape", async () => {
    const t = await aiBackend();
    const routed = await t.mutation(api.ai.routing.setRoute, { capability: "smartEstimates", model: "opencodeGo/glm-5.3" });
    expect(routed).toStrictEqual({ ok: true, value: { changed: true, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.routing.setRoute, { capability: "smartEstimates", model: "opencodeGo/glm-5.3" })).toStrictEqual({
      ok: true,
      value: { changed: false, activityId: null },
    });
    expect(await t.mutation(api.ai.routing.setRoute, { capability: "smartEstimates", model: "openai/gpt-9" })).toStrictEqual({
      ok: false,
      error: { kind: "unknown_model", model: "openai/gpt-9" },
    });
    expect(await t.mutation(api.ai.routing.setRoute, { capability: "breakIntoSteps", model: "openai/decisions/gpt-6-luna" })).toStrictEqual({
      ok: false,
      error: { kind: "model_cannot_answer", model: "openai/decisions/gpt-6-luna" },
    });
    expect(await t.mutation(api.ai.routing.setRoute, { capability: "tripDetection", on: false })).toStrictEqual({
      ok: false,
      error: { kind: "switched_elsewhere", feature: "places" },
    });
    const asking = await t.mutation(api.ai.routing.setAskFirst, { on: true });
    expect(asking).toStrictEqual({ ok: true, value: { changed: true, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.routing.setAskFirst, { on: true })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
  });
});

describe("memory on the wire", () => {
  test("add, edit, pin and setOn answer with their ids and the Activity, and refuse in their shapes", async () => {
    const t = await aiBackend();
    const added = await t.mutation(api.ai.memory.add, { text: "  Likes   tea  " });
    const memoryId = await t.run(async (ctx) => (await ctx.db.query("memories").unique())!._id);
    expect(added).toStrictEqual({ ok: true, value: { memoryId, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.memory.add, { text: "   " })).toStrictEqual({ ok: false, error: { kind: "empty" } });

    const edited = await t.mutation(api.ai.memory.edit, { memoryId, text: "Likes green tea" });
    expect(edited).toStrictEqual({ ok: true, value: { memoryId, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.memory.edit, { memoryId, text: " " })).toStrictEqual({ ok: false, error: { kind: "empty" } });

    const pinned = await t.mutation(api.ai.memory.pin, { memoryId, pinned: true });
    expect(pinned).toStrictEqual({ ok: true, value: { memoryId, activityId: await latestActivity(t) } });

    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("memories", { text: "x", kind: "goal", source: { kind: "avi" }, pinned: false, createdAt: NOW });
      await ctx.db.delete("memories", id);
      return id;
    });
    expect(await t.mutation(api.ai.memory.edit, { memoryId: gone, text: "y" })).toStrictEqual({ ok: false, error: { kind: "not_found" } });
    expect(await t.mutation(api.ai.memory.pin, { memoryId: gone, pinned: true })).toStrictEqual({ ok: false, error: { kind: "not_found" } });

    const off = await t.mutation(api.ai.memory.setOn, { on: false });
    expect(off).toStrictEqual({ ok: true, value: { changed: true, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.memory.setOn, { on: false })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
  });

  test("list answers with every memory, where it came from and the index counts", async () => {
    const t = await aiBackend();
    unwrap(await t.mutation(api.ai.memory.add, { text: "Likes tea", kind: "preference" }));
    const memory = await t.run(async (ctx) => (await ctx.db.query("memories").unique())!);
    expect(await t.query(api.ai.memory.list, {})).toStrictEqual({
      on: true,
      memories: [{ ...memory, from: "You wrote it" }],
      index: { task: 0, project: 0, area: 0, embedded: 0, total: 0, more: false },
    });
  });

  test("forget answers with what was forgotten or not_found, and forgetAll with the count", async () => {
    const t = await aiBackend();
    const { memoryId } = unwrap(await t.mutation(api.ai.memory.add, { text: "Sister is called Maya", kind: "person" }));
    expect(await t.mutation(api.ai.memory.forget, { memoryId })).toStrictEqual({ ok: true, value: { text: "Sister is called Maya", kind: "person" } });
    expect(await t.mutation(api.ai.memory.forget, { memoryId })).toStrictEqual({ ok: false, error: { kind: "not_found" } });
    unwrap(await t.mutation(api.ai.memory.add, { text: "One" }));
    unwrap(await t.mutation(api.ai.memory.add, { text: "Two" }));
    expect(await t.mutation(api.ai.memory.forgetAll, {})).toStrictEqual({ forgotten: 2 });
    expect(await t.mutation(api.ai.memory.forgetAll, {})).toStrictEqual({ forgotten: 0 });
  });
});

describe("Break into steps on the wire", () => {
  test("request, forTask and dismiss answer in their shapes through each view", async () => {
    const off = await newBackend();
    const offTask = await addTask(off, "Write essay");
    expect(await off.mutation(api.ai.steps.request, { taskId: offTask })).toStrictEqual({ requested: false });
    expect(await off.query(api.ai.steps.forTask, { taskId: offTask })).toStrictEqual({ kind: "off" });

    const t = await aiBackend();
    const taskId = await addTask(t, "Write essay");
    expect(await t.query(api.ai.steps.forTask, { taskId })).toStrictEqual({ kind: "idle" });
    expect(await t.mutation(api.ai.steps.request, { taskId })).toStrictEqual({ requested: true });
    expect(await t.query(api.ai.steps.forTask, { taskId })).toStrictEqual({ kind: "thinking" });
    await settleSteps(t);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toStrictEqual({
      kind: "steps",
      steps: ["Draft the outline", "Write the body"],
      project: false,
      answeredBy: "openai/gpt-6-luna",
    });
    expect(await t.mutation(api.ai.steps.dismiss, { taskId })).toBeNull();
    expect(await t.query(api.ai.steps.forTask, { taskId })).toStrictEqual({ kind: "idle" });

    server.resetHandlers(http.post(OPENAI_CHAT_URL, () => new HttpResponse("{}", { status: 503 })));
    await t.mutation(api.ai.steps.request, { taskId });
    await settleSteps(t);
    expect(await t.query(api.ai.steps.forTask, { taskId })).toStrictEqual({ kind: "failed", error: "unavailable" });
    expect(await t.mutation(api.ai.steps.request, { taskId: await goneTask(t) })).toStrictEqual({ requested: false });
  });

  test("accept answers with the new Checklist Items and the Activity, and refuses a gone Task or an empty step", async () => {
    const t = await aiBackend();
    const taskId = await addTask(t, "Write essay");
    const accepted = await t.mutation(api.ai.steps.accept, { taskId, titles: ["Draft", "Write"] });
    const itemIds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("checklistItems")
          .withIndex("by_task_order", (q) => q.eq("taskId", taskId))
          .collect()
      ).map((item) => item._id),
    );
    expect(accepted).toStrictEqual({ ok: true, value: { itemIds, activityId: await latestActivity(t) } });
    expect(await t.mutation(api.ai.steps.accept, { taskId, titles: [] })).toStrictEqual({ ok: true, value: { itemIds: [], activityId: null } });
    expect(await t.mutation(api.ai.steps.accept, { taskId, titles: ["Draft", "  "] })).toStrictEqual({ ok: false, error: { kind: "empty_title" } });
    const gone = await goneTask(t);
    expect(await t.mutation(api.ai.steps.accept, { taskId: gone, titles: ["Draft"] })).toStrictEqual({
      ok: false,
      error: { kind: "not_found", table: "tasks", id: gone },
    });
  });
});

describe("runs on the wire", () => {
  test("start answers with the Job and its thread, and refuses an empty ask or AI off", async () => {
    const off = await newBackend();
    expect(await off.mutation(api.ai.runs.start, { request: "Plan my week", mode: "run" })).toStrictEqual({ ok: false, error: { kind: "not_configured" } });

    const t = await aiBackend();
    expect(await t.mutation(api.ai.runs.start, { request: "   ", mode: "run" })).toStrictEqual({ ok: false, error: { kind: "empty_request" } });
    const started = await t.mutation(api.ai.runs.start, { request: "Plan my week", mode: "run" });
    const job = await t.run(async (ctx) => (await ctx.db.query("jobs").unique())!);
    expect(started).toStrictEqual({ ok: true, value: { jobId: job._id, threadId: job.job.payload.threadId } });
  });

  test("get, live, recent and receipt answer with the run, its changes and each Activity", async () => {
    const t = await aiBackend();
    replies.push({ calls: [{ name: "create_task", input: { title: "Buy floss" } }] }, { text: "Added." });
    const { jobId, threadId } = unwrap(await t.mutation(api.ai.runs.start, { request: "Remind me to buy floss", mode: "run" }));
    await settleRuns(t);
    const job = await jobOf(t, jobId);
    const view = {
      jobId,
      threadId,
      request: "Remind me to buy floss",
      mode: "run",
      status: "done",
      startedAt: job._creationTime,
      answeredBy: "openai/gpt-6-luna",
      error: null,
    };
    expect(await t.query(api.ai.runs.get, { jobId })).toStrictEqual(view);
    expect(await t.query(api.ai.runs.live, {})).toStrictEqual({ ...view, changes: 1, undone: false });
    expect(await t.query(api.ai.runs.recent, {})).toStrictEqual([{ ...view, changes: 1, undone: false }]);
    const entry = await t.run(async (ctx) => (await ctx.db.query("activity").unique())!);
    expect(await t.query(api.ai.runs.receipt, { jobId })).toStrictEqual([
      {
        id: entry._id,
        at: new Date(entry.at).toISOString(),
        action: entry.action,
        actor: "agentRun",
        runId: jobId,
        runName: "Remind me to buy floss",
        subject: "Buy floss",
        changes: 1,
        undone: false,
      },
    ]);
    expect(await t.mutation(api.ai.runs.dismiss, { jobId })).toBeNull();
    expect(await t.query(api.ai.runs.live, {})).toBeNull();
    expect(await t.query(api.ai.runs.get, { jobId: (await t.run((ctx) => ctx.db.insert("jobs", { job: { kind: "agent", payload: { request: "x" } }, idempotencyKey: "x", status: { kind: "queued", availableAt: NOW }, attempts: 0 }))) })).toBeNull();
  });

  test("a run every model fails answers as failed with the reason", async () => {
    const t = await aiBackend();
    replies.push({ status: 500 });
    const { jobId, threadId } = unwrap(await t.mutation(api.ai.runs.start, { request: "Hello", mode: "ask" }));
    await settleRuns(t);
    const job = await jobOf(t, jobId);
    expect(job.status.kind).toBe("failed");
    expect(await t.query(api.ai.runs.get, { jobId })).toStrictEqual({
      jobId,
      threadId,
      request: "Hello",
      mode: "ask",
      status: "failed",
      startedAt: job._creationTime,
      answeredBy: null,
      error: job.status.kind === "failed" ? job.status.error : "",
    });
  });

  test("tell, respond and stop answer in their shapes, and refuse a run that is not waiting", async () => {
    const t = await aiBackend();
    const taskId = await addTask(t, "Old idea");
    replies.push({ calls: [{ name: "set_task_status", input: { taskId, status: "trashed" } }] });
    const { jobId, threadId } = unwrap(await t.mutation(api.ai.runs.start, { request: "Bin Old idea", mode: "run" }));
    expect(await t.mutation(api.ai.runs.tell, { jobId, text: "Wait" })).toStrictEqual({ ok: false, error: { kind: "not_waiting" } });
    expect(await t.mutation(api.ai.runs.respond, { jobId, decisions: [] })).toStrictEqual({ ok: false, error: { kind: "not_waiting" } });
    await settleRuns(t);
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "needsYou" });

    const page = await t.query(api.ai.runs.messages, { threadId: threadId!, paginationOpts: { numItems: 20, cursor: null } });
    const asking = page.page.flatMap((message) => message.parts).find((part) => part.type === "tool-set_task_status");
    const approvalId = asking && "approval" in asking ? (asking.approval?.id ?? "") : "";
    replies.push({ text: "It is in the Trash." });
    expect(await t.mutation(api.ai.runs.respond, { jobId, decisions: [{ approvalId, approved: true }] })).toStrictEqual({ ok: true, value: { jobId } });
    await settleRuns(t);
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "done" });
    expect(await t.mutation(api.ai.runs.respond, { jobId, decisions: [] })).toStrictEqual({ ok: false, error: { kind: "not_waiting" } });

    replies.push({ text: "Noted." });
    expect(await t.mutation(api.ai.runs.tell, { jobId, text: "  " })).toStrictEqual({ ok: false, error: { kind: "not_waiting" } });
    expect(await t.mutation(api.ai.runs.tell, { jobId, text: "Thanks" })).toStrictEqual({ ok: true, value: { jobId } });
    expect(await t.mutation(api.ai.runs.stop, { jobId })).toBeNull();
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "failed", error: "stopped" });
  });

  test("messages answers with an empty quiet page for a thread that is not a run", async () => {
    const t = await aiBackend();
    expect(await t.query(api.ai.runs.messages, { threadId: "not-a-run", paginationOpts: { numItems: 10, cursor: null } })).toStrictEqual({
      page: [],
      isDone: true,
      continueCursor: "",
      streams: { kind: "list", messages: [] },
    });
  });
});

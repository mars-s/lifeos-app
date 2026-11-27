import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { GO_CHAT_URL, newBackend, OPENAI_CHAT_URL, switchAiOn, unwrap, type Backend } from "../backend.test-utils";
import { asksFirst, QUIET_CHANGE_LIMIT } from "./policy";

type Reply = { text?: string; calls?: { name: string; input: Record<string, unknown> }[] } | { status: number };

const server = setupServer();
const replies: { url: string; reply: Reply }[] = [];
const requests: { url: string; tools: string[]; prompt: string }[] = [];

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "served", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const sse = (reply: Exclude<Reply, { status: number }>) => {
  const calls = reply.calls ?? [];
  const body = [
    ...(reply.text ? [chunk({ role: "assistant", content: reply.text })] : []),
    ...calls.map((call, index) =>
      chunk({ role: "assistant", tool_calls: [{ index, id: `call_${call.name}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input) } }] }),
    ),
    chunk({}, calls.length > 0 ? "tool_calls" : "stop"),
    `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "served", choices: [], usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new HttpResponse(body, { headers: { "content-type": "text/event-stream" } });
};

const answer = async ({ request }: { request: Request }) => {
  const body = (await request.json()) as { tools?: { function: { name: string } }[]; messages?: { content: unknown }[] };
  requests.push({ url: request.url, tools: (body.tools ?? []).map((tool) => tool.function.name), prompt: JSON.stringify(body.messages ?? []) });
  const reply = replies.splice(replies.findIndex((entry) => entry.url === request.url) >>> 0, 1)[0]?.reply;
  if (!reply) return HttpResponse.json({ error: { message: "No reply queued for this test" } }, { status: 500 });
  return "status" in reply ? HttpResponse.json({ error: { message: "refused" } }, { status: reply.status }) : sse(reply);
};

const queue = (...steps: Reply[]) => replies.push(...steps.map((reply) => ({ url: OPENAI_CHAT_URL, reply })));

const newAiBackend = async () => {
  const t = await newBackend();
  await switchAiOn(t, { smartEstimates: { on: false, model: "openai/decisions/gpt-6-luna" } });
  return t;
};

const runStep = async (t: Backend, args: { jobId: Id<"jobs">; promptMessageId: string }) => {
  const step = { finished: false };
  const running = t.action(internal.ai.runs.step, args).finally(() => {
    step.finished = true;
  });
  while (!step.finished) await vi.advanceTimersByTimeAsync(5);
  await running;
};

const settle = async (t: Backend) => {
  for (;;) {
    const pending = await t.run(async (ctx) => {
      const steps = (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name === "ai/runs:step" && job.state.kind === "pending");
      for (const job of steps) await ctx.scheduler.cancel(job._id);
      return steps.map((job) => job.args[0] as { jobId: Id<"jobs">; promptMessageId: string });
    });
    if (pending.length === 0) return;
    for (const args of pending) await runStep(t, args);
  }
};

const startRun = async (t: Backend, request: string, mode: "ask" | "run" = "run", taskId?: Id<"tasks">) => {
  const { jobId } = unwrap(await t.mutation(api.ai.runs.start, { request, mode, ...(taskId ? { taskId } : {}) }));
  await settle(t);
  return jobId;
};

const taskTitled = (t: Backend, title: string) => t.run(async (ctx) => (await ctx.db.query("tasks").collect()).find((task) => task.title === title) ?? null);

const threadOf = async (t: Backend, jobId: Id<"jobs">) => (await t.query(api.ai.runs.get, { jobId }))?.threadId ?? "";

const partsOf = async (t: Backend, jobId: Id<"jobs">) =>
  (await t.query(api.ai.runs.messages, { threadId: await threadOf(t, jobId), paginationOpts: { numItems: 20, cursor: null } })).page.flatMap((message) => message.parts);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  replies.length = 0;
  requests.length = 0;
  server.resetHandlers(http.post(OPENAI_CHAT_URL, answer), http.post(GO_CHAT_URL, answer));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("a run", () => {
  test("acts through the same tools as MCP, as its own Agent Run, and one undo takes it back", async () => {
    const t = await newAiBackend();
    queue({ calls: [{ name: "create_task", input: { title: "Buy floss", when: "today" } }] }, { text: "Done: Buy floss is in Today." });
    const jobId = await startRun(t, "Remind me to buy floss today");

    expect((await taskTitled(t, "Buy floss"))?.when).toMatchObject({ kind: "scheduled" });
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "done", mode: "run", request: "Remind me to buy floss today", answeredBy: "openai/gpt-6-luna" });
    const actors = await t.run(async (ctx) => (await ctx.db.query("activity").collect()).map((entry) => entry.actor));
    expect(actors).toEqual([{ kind: "agentRun", jobId }]);

    unwrap(await t.mutation(api.platform.undo.undoRun, { jobId }));
    expect(await taskTitled(t, "Buy floss")).toBeNull();
  });

  test("keeps its words in the thread, so every device reads the same answer", async () => {
    const t = await newAiBackend();
    queue({ text: "You have nothing due today." });
    const jobId = await startRun(t, "What is due today?");
    const page = await t.query(api.ai.runs.messages, { threadId: await threadOf(t, jobId), paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page.map((message) => [message.role, message.text])).toEqual([
      ["user", "What is due today?"],
      ["assistant", "You have nothing due today."],
    ]);
  });

  test("asks first before the Trash, changes nothing until Avi says yes, then carries on", async () => {
    const t = await newAiBackend();
    queue({ calls: [{ name: "create_task", input: { title: "Old idea" } }] }, { text: "Made it." });
    await startRun(t, "Add Old idea");
    const task = await taskTitled(t, "Old idea");

    queue({ calls: [{ name: "set_task_status", input: { taskId: task?._id ?? "", status: "trashed" } }] });
    const jobId = await startRun(t, "Bin Old idea");
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "needsYou" });
    expect((await taskTitled(t, "Old idea"))?.trashedAt).toBeUndefined();

    const asking = (await partsOf(t, jobId)).find((part) => part.type === "tool-set_task_status");
    const approvalId = asking && "approval" in asking ? asking.approval?.id : undefined;
    expect(approvalId).toBeTypeOf("string");

    queue({ text: "It is in the Trash." });
    unwrap(await t.mutation(api.ai.runs.respond, { jobId, decisions: [{ approvalId: approvalId ?? "", approved: true }] }));
    await settle(t);
    expect((await taskTitled(t, "Old idea"))?.trashedAt).toBeTypeOf("number");
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "done" });
  });

  test("Cmd+J asks get only the reading tools, so they can suggest but never change anything", async () => {
    const t = await newAiBackend();
    queue({ text: "Try a 25 minute block after lunch." });
    await startRun(t, "When should I do this?", "ask");
    expect(requests[0]?.tools).toContain("get_task");
    expect(requests[0]?.tools).not.toContain("create_task");
    expect(requests[0]?.tools).not.toContain("undo");
  });

  test("Cmd+J on a Task reads the Task and drafts steps in pencil, and nothing is saved", async () => {
    const t = await newAiBackend();
    const taskId = await t.run((ctx) =>
      ctx.db.insert("tasks", { title: "Plan the Japan trip", notes: "Ten days in April", when: { kind: "anytime" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "a0" }),
    );
    queue({ text: "Here are the steps.", calls: [{ name: "propose_steps", input: { steps: ["Pick the cities", "Book flights", "Book the rail pass"], why: "Flights first, they fill up." } }] }, { text: "Keep them if they look right." });
    const jobId = await startRun(t, "Break this into steps", "ask", taskId);

    expect(requests[0]?.prompt).toContain("Plan the Japan trip");
    expect(requests[0]?.prompt).toContain("Ten days in April");
    expect(requests[0]?.tools).toEqual(expect.arrayContaining(["propose_steps", "propose_estimate", "propose_time", "propose_notes"]));
    const drafted = (await partsOf(t, jobId)).find((part) => part.type === "tool-propose_steps");
    expect(drafted && "input" in drafted ? drafted.input : null).toMatchObject({ steps: ["Pick the cities", "Book flights", "Book the rail pass"] });
    expect(await t.run(async (ctx) => (await ctx.db.query("activity").collect()).length)).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("checklistItems").collect()).length)).toBe(0);
  });

  test("does not start while AI is off, and an empty ask is refused", async () => {
    const t = await newBackend();
    expect(await t.mutation(api.ai.runs.start, { request: "Plan my week", mode: "run" })).toEqual({ ok: false, error: { kind: "not_configured" } });
    const on = await newAiBackend();
    expect(await on.mutation(api.ai.runs.start, { request: "   ", mode: "run" })).toEqual({ ok: false, error: { kind: "empty_request" } });
  });

  test("a model that fails hands over to the next one, and if every model fails the run says so", async () => {
    const t = await newAiBackend();
    vi.stubEnv("OPENCODE_GO_API_KEY", "go-test");
    queue({ status: 401 });
    replies.push({ url: GO_CHAT_URL, reply: { text: "Here you go." } });
    const jobId = await startRun(t, "Hello");
    expect(await t.query(api.ai.runs.get, { jobId })).toMatchObject({ status: "done", answeredBy: "opencodeGo/deepseek-v4.1-flash" });

    vi.stubEnv("OPENCODE_GO_API_KEY", undefined);
    queue({ status: 500 });
    const failed = await startRun(t, "Hello again");
    expect(await t.query(api.ai.runs.get, { jobId: failed })).toMatchObject({ status: "failed" });
  });
});

describe("the approval policy", () => {
  const write = { toolName: "update_task", input: {}, readOnly: false, changesSoFar: 0, askFirst: false };

  test("reads and ordinary writes run; the Trash, a Task becoming a Project and big batches ask first", () => {
    expect(asksFirst({ ...write, toolName: "search", readOnly: true, askFirst: true })).toBe(false);
    expect(asksFirst(write)).toBe(false);
    expect(asksFirst({ ...write, toolName: "set_task_status", input: { status: "completed" } })).toBe(false);
    expect(asksFirst({ ...write, toolName: "set_task_status", input: { status: "trashed" } })).toBe(true);
    expect(asksFirst({ ...write, toolName: "convert_task_to_project" })).toBe(true);
    expect(asksFirst({ ...write, changesSoFar: QUIET_CHANGE_LIMIT - 1 })).toBe(false);
    expect(asksFirst({ ...write, changesSoFar: QUIET_CHANGE_LIMIT })).toBe(true);
  });

  test("the ask before every change setting makes every write ask", () => {
    expect(asksFirst({ ...write, askFirst: true })).toBe(true);
  });
});

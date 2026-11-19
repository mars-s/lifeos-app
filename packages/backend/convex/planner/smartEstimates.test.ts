import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";
import { calibrationOf, DECISIONS_URL, nearestExamples, nudged, parseDecision, type PastTask } from "./smartEstimateModel";

type Asked = { authorization: string | null; body: Record<string, unknown> };

const openai = setupServer();

const decisionsAnswering = (answers: Record<string, unknown>[], status = 200) => {
  const asked: Asked[] = [];
  openai.resetHandlers(
    http.post(DECISIONS_URL, async ({ request }) => {
      asked.push({ authorization: request.headers.get("authorization"), body: (await request.json()) as Record<string, unknown> });
      return status === 200
        ? HttpResponse.json({ model: "gpt-6-luna", answers, usage: { input_tokens: 420, output_tokens: 0 } })
        : new HttpResponse("{}", { status });
    }),
  );
  return asked;
};

const choosing = (minutes: number, { confidence = 0.81, vague = 0.04 } = {}) =>
  decisionsAnswering([
    {
      type: "choice",
      name: "estimate",
      choice: String(minutes),
      confidence,
      probabilities: [
        { value: String(minutes), probability: 0.86 },
        { value: "60", probability: 0.1 },
        { value: "999", probability: 0.04 },
      ],
    },
    { type: "predicate", name: "too_vague", probability: vague },
  ]);

const outcomeOf = (t: Backend) => t.run(async (ctx) => (await ctx.db.query("estimateSuggestions").first())?.outcome);

const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

const minute = 60_000;

const seedHistory = async (t: Backend) =>
  t.run(async (ctx) => {
    const areaId = await ctx.db.insert("areas", { title: "University", colour: "violet", order: "a0" });
    const labelId = await ctx.db.insert("labels", { name: "Deep Work", colour: "teal", order: "a0" });
    const past = async (title: string, estimateMinutes: number, actualMinutes: number) => {
      const at = Date.now() - 86_400_000;
      const taskId = await ctx.db.insert("tasks", {
        title,
        notes: "private notes about Jordan",
        when: { kind: "anytime" },
        estimateMinutes,
        parent: { kind: "area", areaId },
        labelIds: [labelId],
        status: { kind: "completed", at },
        order: "a0",
      });
      const start = at - actualMinutes * minute;
      await ctx.db.insert("focusSessions", { taskId, kind: "focus", start, pausedMs: 0, state: { kind: "ended", at } });
      return taskId;
    };
    await past("Write essay introduction", 30, 45);
    await past("Write essay conclusion", 30, 40);
    await past("Read week 6 papers", 60, 80);
    await past("Buy groceries", 20, 20);
    return { areaId, labelId };
  });

const past = (title: string, extra: Partial<PastTask> = {}) => ({ title, notes: "", checklistItems: 0, labels: [], ...extra }) satisfies PastTask;

const suggestionFor = (t: Backend, taskId: Id<"tasks">) => t.query(api.planner.smartEstimates.forTask, { taskId });

beforeAll(() => openai.listen({ onUnhandledRequest: "error" }));
afterAll(() => openai.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
});

afterEach(() => {
  openai.resetHandlers();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("suggesting an Estimate", () => {
  test("a new Task without an Estimate gets one suggestion, built from its fields and the nearest past Tasks", async () => {
    const t = await newBackend();
    const { areaId, labelId } = await seedHistory(t);
    const asked = choosing(30);
    const { taskId } = unwrap(
      await t.mutation(api.planner.tasks.create, {
        title: "Write essay body",
        notes: "  Three sections,\n\n  with sources  ",
        parent: { kind: "area", areaId },
        labelIds: [labelId],
      }),
    );
    expect(await suggestionFor(t, taskId)).toBeNull();

    await settle(t);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.authorization).toBe("Bearer sk-test");
    const body = asked[0]!.body as {
      model: string;
      prompt_cache_key: string;
      input: { role: string; content: unknown }[];
      questions: { type: string; name: string; choices?: { value: string }[] }[];
    };
    expect(body.model).toBe("gpt-6-luna");
    expect(body.prompt_cache_key).toBe("lifeos-smart-estimate");
    expect(body.input[0]?.role).toBe("developer");
    expect(body.questions.map(({ type, name }) => [type, name])).toEqual([
      ["choice", "estimate"],
      ["predicate", "too_vague"],
    ]);
    expect(body.questions[0]?.choices?.map(({ value }) => value)).toEqual(["5", "10", "15", "30", "45", "60", "90", "120", "180", "240"]);
    const data = (body.input[1]!.content as { data: { task: unknown; examples: { title: string }[] } }[])[0]?.data;
    expect(data?.task).toEqual({
      title: "Write essay body",
      notes: "Three sections, with sources",
      checklistItems: 0,
      area: "University",
      labels: ["Deep Work"],
    });
    expect(data?.examples.slice(0, 2).map(({ title }) => title).toSorted()).toEqual(["Write essay conclusion", "Write essay introduction"]);
    expect(data).not.toHaveProperty("calibration");
    expect(JSON.stringify(body)).not.toContain("Jordan");
    expect(JSON.stringify(body)).not.toContain(taskId);

    expect(await suggestionFor(t, taskId)).toEqual({
      minutes: 45,
      reason: "Like “Write essay introduction”, which took 0:45. You usually run 33% over on Tasks like this, so not 0:30.",
    });
    expect(await outcomeOf(t)).toMatchObject({
      kind: "suggested",
      minutes: 45,
      modelMinutes: 30,
      confidence: 0.81,
      probabilities: [
        { minutes: 30, probability: 0.86 },
        { minutes: 60, probability: 0.1 },
      ],
      model: "gpt-6-luna",
    });
  });

  test("a low-confidence pick is kept but not shown, and a Task too vague to estimate gets no chip", async () => {
    const t = await newBackend();
    choosing(60, { confidence: 0.2 });
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Plan the trip" }));
    await settle(t);
    expect(await outcomeOf(t)).toMatchObject({ kind: "suggested", minutes: 60, confidence: 0.2 });
    expect(await suggestionFor(t, taskId)).toBeNull();

    choosing(30, { vague: 0.92 });
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Stuff" }));
    await settle(t);
    expect(await outcomeOf(t)).toMatchObject({ kind: "unclear", vague: 0.92 });
    expect(await suggestionFor(t, taskId)).toBeNull();
  });

  test("accepting the suggestion sets the Estimate through the normal change, so it undoes, and the suggestion steps aside", async () => {
    const t = await newBackend();
    choosing(30);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    const suggestion = await suggestionFor(t, taskId);
    expect(suggestion).toEqual({ minutes: 30, reason: "From the title and notes." });

    const { activityId } = unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: suggestion!.minutes }));
    expect((await t.query(api.planner.tasks.card, { taskId }))?.estimateMinutes).toBe(30);
    expect(await suggestionFor(t, taskId)).toBeNull();

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect((await t.query(api.planner.tasks.card, { taskId }))?.estimateMinutes).toBeUndefined();
    expect(await suggestionFor(t, taskId)).toEqual(suggestion);
  });

  test("a Task created with an Estimate is never sent", async () => {
    const t = await newBackend();
    const asked = choosing(30);
    unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor", estimateMinutes: 15 }));
    await settle(t);
    expect(asked).toEqual([]);
  });

  test("quick renames are debounced into one call with the latest title", async () => {
    const t = await newBackend();
    const asked = choosing(120);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "New Task" }));
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft" }));
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the literature review" }));
    await settle(t);
    expect(asked).toHaveLength(1);
    const data = (asked[0]!.body.input as { content: { data: { task: { title: string } } }[] }[])[1]?.content[0]?.data;
    expect(data?.task.title).toBe("Draft the literature review");
    expect((await suggestionFor(t, taskId))?.minutes).toBe(120);
  });

  test("the same inputs are never asked twice, and opening the card asks only for a Task with no suggestion yet", async () => {
    const t = await newBackend();
    const asked = choosing(15);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Pay rent" }));
    await settle(t);
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });

    const requestedAt = Date.now() + 10;
    await t.run(async (ctx) => {
      const row = await ctx.db.query("estimateSuggestions").first();
      await ctx.db.patch("estimateSuggestions", row!._id, { requestedAt });
    });
    await t.action(internal.planner.smartEstimates.suggest, { taskId, requestedAt });
    expect(asked).toHaveLength(1);

    const imported = await t.run((ctx) =>
      ctx.db.insert("tasks", { title: "Imported from Things", notes: "", when: { kind: "inbox" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "b0" }),
    );
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId: imported })).toEqual({ requested: true });
    await settle(t);
    expect(asked).toHaveLength(2);
    expect((await suggestionFor(t, imported))?.minutes).toBe(15);
  });

  test("a refused key or a refusal is stored as a failure and shows nothing", async () => {
    const t = await newBackend();
    decisionsAnswering([], 401);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Renew licence" }));
    await settle(t);
    expect(await suggestionFor(t, taskId)).toBeNull();
    expect(await outcomeOf(t)).toMatchObject({ kind: "failed", error: { kind: "unauthorised" } });

    decisionsAnswering([{ type: "refusal", name: "estimate" }]);
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renew driver licence" }));
    await settle(t);
    expect(await outcomeOf(t)).toMatchObject({ kind: "failed", error: { kind: "refused" } });
  });
});

describe("the Smart Estimates preference", () => {
  test("off means no OpenAI call at all and no suggestion shown, and the switch itself undoes", async () => {
    const t = await newBackend();
    const asked = choosing(30);
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: true });

    const { activityId } = unwrap(await t.mutation(api.platform.preferences.setSmartEstimates, { enabled: false }));
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book dentist" }));
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });
    await settle(t);
    expect(asked).toEqual([]);
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: false, configured: true });

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: true });
  });

  test("with no OPENAI_API_KEY it says not set up and does nothing", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newBackend();
    const asked = choosing(30);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book dentist" }));
    await settle(t);
    expect(asked).toEqual([]);
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: false });
    expect(await t.run(async (ctx) => ctx.db.query("estimateSuggestions").collect())).toEqual([]);
    expect(await suggestionFor(t, taskId)).toBeNull();
  });
});

describe("the estimate model", () => {
  test("calibration prefers similar Tasks, falls back to all history with three Tasks, and nudges the pick", () => {
    const history = [past("a", { estimateMinutes: 30, actualMinutes: 60 }), past("b", { estimateMinutes: 60, actualMinutes: 60 })];
    expect(calibrationOf([], history)).toBeUndefined();
    const overall = calibrationOf([], [...history, past("c", { estimateMinutes: 10, actualMinutes: 15 })]);
    expect(overall).toEqual({ ratio: 1.5, tasks: 3, scope: "overall" });
    expect(calibrationOf(history, history)).toEqual({ ratio: 1.5, tasks: 2, scope: "similar" });
    expect(nudged(30, overall)).toBe(45);
    expect(nudged(30, { ratio: 1.1, tasks: 5, scope: "overall" })).toBe(30);
    expect(nudged(60, { ratio: 0.5, tasks: 5, scope: "similar" })).toBe(30);
  });

  test("nearest examples rank shared title words over a shared Area, and skip Tasks with no time", () => {
    const task = { title: "Write thesis chapter", notes: "", checklistItems: 0, area: "University", labels: [] };
    const examples = nearestExamples(task, [
      past("Gym", { area: "University", estimateMinutes: 60 }),
      past("Write thesis outline", { estimateMinutes: 45 }),
      past("Write thesis chapter two"),
      past("Groceries", { estimateMinutes: 20 }),
    ]);
    expect(examples.map(({ title }) => title)).toEqual(["Write thesis outline", "Gym"]);
  });

  test("an answer outside the offered choices is refused", () => {
    expect(parseDecision({ answers: [{ type: "choice", name: "estimate", choice: "37", confidence: 1 }] })._unsafeUnwrapErr()).toEqual({
      kind: "invalid_response",
    });
    expect(parseDecision({ answers: [{ type: "choice", name: "estimate", choice: "45", confidence: 0.6 }], model: "gpt-6-luna" })._unsafeUnwrap()).toEqual({
      pick: 45,
      confidence: 0.6,
      probabilities: [],
      vague: 0,
      model: "gpt-6-luna",
    });
  });
});

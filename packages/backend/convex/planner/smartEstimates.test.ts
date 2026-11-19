import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";
import { bucketsFor, calibrationOf, DECISIONS_URL, guessesFrom, isPlaceholderTitle, nearestExamples, nudged, parseDecision, type PastTask } from "./smartEstimateModel";

const BUCKETS = bucketsFor(510);

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

const choosing = (choice: string, { runnerUp = "1 hour", vague = 0.04 } = {}) =>
  decisionsAnswering([
    {
      type: "choice",
      name: "estimate",
      choice,
      confidence: 0.81,
      probabilities: [
        { value: choice, probability: 0.86 },
        { value: runnerUp, probability: 0.1 },
        { value: "5 minutes", probability: 0.02 },
        { value: "a fortnight", probability: 0.02 },
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

const viewFor = (t: Backend, taskId: Id<"tasks">) => t.query(api.planner.smartEstimates.forTask, { taskId });

const sentTo = (asked: Asked[], index = 0) =>
  asked[index]!.body as {
    model: string;
    prompt_cache_key: string;
    input: { role: string; content: unknown }[];
    questions: { type: string; name: string; choices?: { value: string; description: string }[] }[];
  };

const userParts = (asked: Asked[], index = 0) =>
  sentTo(asked, index).input[1]!.content as ({ type: "input_text"; text: string } | { type: "input_json"; data: { similarPastTasks: { title: string }[] } })[];

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

describe("guessing an Estimate", () => {
  test("a new Task is shown as thinking, then gets up to three guesses from its title, description and nearest past Tasks", async () => {
    const t = await newBackend();
    const { areaId, labelId } = await seedHistory(t);
    const asked = choosing("30 minutes");
    const { taskId } = unwrap(
      await t.mutation(api.planner.tasks.create, {
        title: "Write essay body",
        notes: "  Three sections,\n\n  with sources  ",
        parent: { kind: "area", areaId },
        labelIds: [labelId],
      }),
    );
    expect(await viewFor(t, taskId)).toEqual({ kind: "thinking" });

    await settle(t);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.authorization).toBe("Bearer sk-test");
    const body = sentTo(asked);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.prompt_cache_key).toBe("lifeos-smart-estimate");
    expect(body.input[0]?.role).toBe("developer");
    expect(body.questions.map(({ type, name }) => [type, name])).toEqual([
      ["choice", "estimate"],
      ["predicate", "too_vague"],
    ]);
    expect(body.questions[0]?.choices?.map(({ value }) => value)).toEqual([
      "5 minutes",
      "10 minutes",
      "15 minutes",
      "20 minutes",
      "30 minutes",
      "45 minutes",
      "1 hour",
      "1.5 hours",
      "2 hours",
      "3 hours",
      "4 hours",
      "6 hours",
      "1 working day",
      "2 working days",
      "3 working days",
      "1 working week",
      "2 working weeks",
    ]);
    const [text, json] = userParts(asked);
    expect(text).toEqual({
      type: "input_text",
      text: "Task: Write essay body\nDescription: Three sections, with sources\nArea: University\nLabels: Deep Work",
    });
    expect(json?.type).toBe("input_json");
    const examples = json?.type === "input_json" ? json.data.similarPastTasks : [];
    expect(examples.slice(0, 2).map(({ title }) => title).toSorted()).toEqual(["Write essay conclusion", "Write essay introduction"]);
    expect(JSON.stringify(body)).not.toContain("Jordan");
    expect(JSON.stringify(body)).not.toContain(taskId);

    expect(await viewFor(t, taskId)).toEqual({
      kind: "guesses",
      guesses: [
        { minutes: 45, probability: 0.86 },
        { minutes: 90, probability: 0.1 },
      ],
      likely: 45,
      reason: "Like “Write essay introduction”, which took 0:45. You usually run 33% over on Tasks like this, so not 0:30.",
      dayMinutes: 510,
    });
    expect(await outcomeOf(t)).toMatchObject({ kind: "suggested", minutes: 45, modelMinutes: 30, confidence: 0.81, model: "gpt-6-luna" });
  });

  test("picking a guess sets the Estimate through the normal change, keeps the guesses on the card, and undoes", async () => {
    const t = await newBackend();
    choosing("10 minutes", { runnerUp: "15 minutes" });
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor" }));
    await settle(t);
    const view = await viewFor(t, taskId);
    expect(view).toEqual({
      kind: "guesses",
      guesses: [
        { minutes: 10, probability: 0.86 },
        { minutes: 15, probability: 0.1 },
      ],
      likely: 10,
      reason: "From the title and notes.",
      dayMinutes: 510,
    });

    const { activityId } = unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 15 }));
    expect((await t.query(api.planner.tasks.card, { taskId }))?.estimateMinutes).toBe(15);
    expect(await viewFor(t, taskId)).toEqual(view);

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect((await t.query(api.planner.tasks.card, { taskId }))?.estimateMinutes).toBeUndefined();
    expect(await viewFor(t, taskId)).toEqual(view);
  });

  test("a placeholder title is never sent, and says why, until it gets a real title", async () => {
    const t = await newBackend();
    const asked = choosing("15 minutes");
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "New Task" }));
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });
    await settle(t);
    expect(asked).toEqual([]);
    expect(await viewFor(t, taskId)).toEqual({ kind: "fallback", why: "untitled" });

    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Pay the electricity bill" }));
    expect(await viewFor(t, taskId)).toEqual({ kind: "thinking" });
    await settle(t);
    expect(asked).toHaveLength(1);
    expect(await viewFor(t, taskId)).toMatchObject({ kind: "guesses", likely: 15 });
  });

  test("a Task created with an Estimate is never sent and keeps the presets", async () => {
    const t = await newBackend();
    const asked = choosing("30 minutes");
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Email supervisor", estimateMinutes: 15 }));
    await settle(t);
    expect(asked).toEqual([]);
    expect(await viewFor(t, taskId)).toEqual({ kind: "presets" });
  });

  test("quick renames are debounced into one call with the latest title, shown as thinking meanwhile", async () => {
    const t = await newBackend();
    const asked = choosing("2 hours");
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Draft" }));
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft chapter" }));
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the literature review" }));
    await settle(t);
    expect(asked).toHaveLength(1);
    expect((userParts(asked)[0] as { text: string }).text).toBe("Task: Draft the literature review");
    expect(await viewFor(t, taskId)).toMatchObject({ kind: "guesses", likely: 120 });

    choosing("3 hours");
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the whole literature review" }));
    expect(await viewFor(t, taskId)).toEqual({ kind: "thinking" });
    await settle(t);
    expect(await viewFor(t, taskId)).toMatchObject({ kind: "guesses", likely: 180 });
  });

  test("the same inputs are never asked twice and never leave the card thinking", async () => {
    const t = await newBackend();
    const asked = choosing("15 minutes");
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Pay rent" }));
    await settle(t);
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });

    const requestedAt = Date.now() + 10;
    await t.run(async (ctx) => {
      const row = await ctx.db.query("estimateSuggestions").first();
      await ctx.db.patch("estimateSuggestions", row!._id, { requestedAt });
    });
    expect(await viewFor(t, taskId)).toEqual({ kind: "thinking" });
    await t.action(internal.planner.smartEstimates.suggest, { taskId, requestedAt });
    expect(asked).toHaveLength(1);
    expect(await viewFor(t, taskId)).toMatchObject({ kind: "guesses", likely: 15 });

    const imported = await t.run((ctx) =>
      ctx.db.insert("tasks", { title: "Imported from Things", notes: "", when: { kind: "inbox" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "b0" }),
    );
    expect(await viewFor(t, imported)).toEqual({ kind: "thinking" });
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId: imported })).toEqual({ requested: true });
    await settle(t);
    expect(asked).toHaveLength(2);
    expect(await viewFor(t, imported)).toMatchObject({ kind: "guesses", likely: 15 });
  });

  test("a vague Task, a refused key or a refusal falls back to the presets with the reason", async () => {
    const t = await newBackend();
    choosing("30 minutes", { vague: 0.92 });
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Stuff for later" }));
    await settle(t);
    expect(await viewFor(t, taskId)).toEqual({ kind: "fallback", why: "vague" });

    decisionsAnswering([], 401);
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renew licence" }));
    await settle(t);
    expect(await viewFor(t, taskId)).toEqual({ kind: "fallback", why: "failed", error: "unauthorised" });

    decisionsAnswering([{ type: "refusal", name: "estimate" }]);
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Renew driver licence" }));
    await settle(t);
    expect(await viewFor(t, taskId)).toEqual({ kind: "fallback", why: "failed", error: "refused" });
  });
});

describe("big work", () => {
  test("a massive Task can be guessed in days, follows the Working Hours, and the guess can be saved as the Estimate", async () => {
    const t = await newBackend();
    unwrap(await t.mutation(api.calendar.workingHours.set, { startMinute: 9 * 60, endMinute: 17 * 60 }));
    choosing("1 working week", { runnerUp: "2 working weeks" });
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Rewrite the entire db in Rust" }));
    await settle(t);
    expect(await viewFor(t, taskId)).toMatchObject({
      kind: "guesses",
      guesses: [
        { minutes: 2400, probability: 0.86 },
        { minutes: 4800, probability: 0.1 },
      ],
      likely: 2400,
      dayMinutes: 480,
    });
    unwrap(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 4800 }));
    expect((await t.query(api.planner.tasks.card, { taskId }))?.estimateMinutes).toBe(4800);
  });
});

describe("the Smart Estimates preference", () => {
  test("off means no OpenAI call and the presets, and the switch itself undoes", async () => {
    const t = await newBackend();
    const asked = choosing("30 minutes");
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: true });

    const { activityId } = unwrap(await t.mutation(api.platform.preferences.setSmartEstimates, { enabled: false }));
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book dentist" }));
    expect(await t.mutation(api.planner.smartEstimates.request, { taskId })).toEqual({ requested: false });
    await settle(t);
    expect(asked).toEqual([]);
    expect(await viewFor(t, taskId)).toEqual({ kind: "presets" });

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: true });
  });

  test("with no key it says not set up, does nothing and keeps the presets", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newBackend();
    const asked = choosing("30 minutes");
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book dentist" }));
    await settle(t);
    expect(asked).toEqual([]);
    expect(await t.query(api.planner.smartEstimates.status, {})).toEqual({ enabled: true, configured: false });
    expect(await t.run(async (ctx) => ctx.db.query("estimateSuggestions").collect())).toEqual([]);
    expect(await viewFor(t, taskId)).toEqual({ kind: "presets" });
  });
});

describe("the estimate model", () => {
  test("calibration prefers similar Tasks, falls back to all history with three Tasks, and nudges the pick", () => {
    const history = [past("a", { estimateMinutes: 30, actualMinutes: 60 }), past("b", { estimateMinutes: 60, actualMinutes: 60 })];
    expect(calibrationOf([], history)).toBeUndefined();
    const overall = calibrationOf([], [...history, past("c", { estimateMinutes: 10, actualMinutes: 15 })]);
    expect(overall).toEqual({ ratio: 1.5, tasks: 3, scope: "overall" });
    expect(calibrationOf(history, history)).toEqual({ ratio: 1.5, tasks: 2, scope: "similar" });
    expect(nudged(BUCKETS, 30, overall)).toBe(45);
    expect(nudged(BUCKETS, 30, { ratio: 1.1, tasks: 5, scope: "overall" })).toBe(30);
    expect(nudged(BUCKETS, 60, { ratio: 0.5, tasks: 5, scope: "similar" })).toBe(30);
  });

  test("guesses merge buckets the nudge folds together, drop tiny ones, keep the top three and sort by length", () => {
    const decision = {
      pick: 30,
      confidence: 0.5,
      probabilities: [
        { minutes: 30, probability: 0.5 },
        { minutes: 20, probability: 0.2 },
        { minutes: 45, probability: 0.15 },
        { minutes: 60, probability: 0.1 },
        { minutes: 10, probability: 0.02 },
      ],
    };
    expect(guessesFrom(BUCKETS, decision, undefined)).toEqual({
      guesses: [
        { minutes: 20, probability: 0.2 },
        { minutes: 30, probability: 0.5 },
        { minutes: 45, probability: 0.15 },
      ],
      likely: 30,
    });
    expect(guessesFrom(BUCKETS, decision, { ratio: 1.5, tasks: 4, scope: "similar" })).toEqual({
      guesses: [
        { minutes: 30, probability: 0.2 },
        { minutes: 45, probability: 0.5 },
        { minutes: 60, probability: 0.15 },
      ],
      likely: 45,
    });
    expect(guessesFrom(BUCKETS, { pick: 60, confidence: 0.4, probabilities: [] }, undefined)).toEqual({ guesses: [{ minutes: 60, probability: 0.4 }], likely: 60 });
  });

  test("big buckets are working days and weeks of Avi's own Working Hours", () => {
    expect(bucketsFor(510).filter((bucket) => bucket.days).map(({ value, minutes }) => [value, minutes])).toEqual([
      ["1 working day", 510],
      ["2 working days", 1020],
      ["3 working days", 1530],
      ["1 working week", 2550],
      ["2 working weeks", 5100],
    ]);
    expect(bucketsFor(480).find((bucket) => bucket.value === "1 working week")?.minutes).toBe(2400);
  });

  test("placeholder titles are not worth classifying", () => {
    expect(["New Task", "  untitled ", "To do", "Do it", "!!"].map(isPlaceholderTitle)).toEqual([true, true, true, true, true]);
    expect(["Gym", "Pay rent", "Read week 6 papers"].map(isPlaceholderTitle)).toEqual([false, false, false]);
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

  test("answers are read by their labels, and one outside the offered choices is refused", () => {
    expect(parseDecision(BUCKETS, { answers: [{ type: "choice", name: "estimate", choice: "37", confidence: 1 }] })._unsafeUnwrapErr()).toEqual({
      kind: "invalid_response",
    });
    expect(
      parseDecision(BUCKETS, {
        answers: [{ type: "choice", name: "estimate", choice: "1.5 hours", confidence: 0.6, probabilities: [{ value: "1.5 hours", probability: 0.6 }] }],
        model: "gpt-6-luna",
      })._unsafeUnwrap(),
    ).toEqual({ pick: 90, confidence: 0.6, probabilities: [{ minutes: 90, probability: 0.6 }], vague: 0, model: "gpt-6-luna" });
  });
});

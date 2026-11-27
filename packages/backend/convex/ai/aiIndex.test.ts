import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { EMBEDDING_DIMENSIONS, PROVIDERS } from "../../shared/ai";
import { newBackend, switchAiOn, unwrap, type Backend } from "../backend.test-utils";
import { fuse } from "./search";

const server = setupServer();
const embedded: string[][] = [];

const axis = (text: string) => (/teeth|dentist|floss/i.test(text) ? 0 : 1);

const vector = (text: string) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === axis(text) ? 1 : 0));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers();
  embedded.length = 0;
  server.resetHandlers(
    http.post(`${PROVIDERS.openai.baseUrl}/embeddings`, async ({ request }) => {
      const body = (await request.json()) as { input: string[]; dimensions: number };
      embedded.push(body.input);
      return HttpResponse.json({ data: body.input.map((text, index) => ({ index, embedding: vector(text) })) });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const aiOn = async () => {
  const t = await newBackend();
  await switchAiOn(t, { smartEstimates: { on: false, model: "openai/decisions/gpt-6-luna" } });
  return t;
};

const newTask = async (t: Backend, title: string) => unwrap(await t.mutation(api.planner.tasks.create, { title, when: { kind: "anytime" } })).taskId;

const find = (t: Backend, query: string) => t.action(internal.ai.search.hybrid, { query });

const rows = (t: Backend) => t.run((ctx) => ctx.db.query("aiIndex").collect());

describe("the index", () => {
  test("every change keeps a Task findable by its words, with AI off and no vector made", async () => {
    const t = await newBackend();
    const taskId = await newTask(t, "Book the dentist");
    expect((await find(t, "dentist")).hits).toMatchObject([{ kind: "task", id: taskId, title: "Book the dentist" }]);

    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Book the hygienist" }));
    expect((await find(t, "dentist")).hits).toEqual([]);
    expect((await find(t, "hygienist")).hits).toHaveLength(1);
    expect((await rows(t)).map((row) => row.embedded)).toEqual([false]);
    expect(embedded).toEqual([]);
  });

  test("a trashed Task leaves the index, and one undo brings it back", async () => {
    const t = await newBackend();
    const taskId = await newTask(t, "Renew the passport");
    const { activityId } = unwrap(await t.mutation(api.planner.tasks.trash, { taskId }));
    expect((await find(t, "passport")).hits).toEqual([]);
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
    expect((await find(t, "passport")).hits).toHaveLength(1);
  });

  test("with an OpenAI key, vectors are made after a quiet spell and search finds meaning, not just words", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const t = await aiOn();
    const dentist = await newTask(t, "Book the dentist");
    await newTask(t, "Buy milk");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(embedded.flat()).toEqual(expect.arrayContaining(["Book the dentist", "Buy milk"]));
    expect((await rows(t)).every((row) => row.embedded && row.embedding?.length === EMBEDDING_DIMENSIONS)).toBe(true);

    const hits = (await find(t, "my teeth hurt")).hits;
    expect(hits[0]?.id).toBe(dentist);
  });

  test("the backfill indexes what was there before the index existed", async () => {
    const t = await newBackend();
    await newTask(t, "Old Task");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("aiIndex").collect()) await ctx.db.delete("aiIndex", row._id);
    });
    await t.action(internal.ai.aiIndex.backfill, {});
    expect((await find(t, "old")).hits.map((hit) => hit.title)).toEqual(["Old Task"]);
  });

  test("something with no words is left out, so the provider is never sent an empty string", async () => {
    const t = await newBackend();
    await t.run((ctx) => ctx.db.insert("areas", { title: "", colour: "slate", order: "a0" }));
    await t.action(internal.ai.aiIndex.backfill, {});
    expect(await rows(t)).toEqual([]);
  });

  test("hits found both ways rank first", () => {
    expect(fuse([["a", "b", "c"], ["c", "d"]])).toEqual(["c", "a", "b", "d"]);
  });
});

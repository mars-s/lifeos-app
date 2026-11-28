import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DECISIONS_URL, newAiBackend as newBackend, unwrap, type Backend } from "../backend.test-utils";
import { NOMINATIM_URL, OVERPASS_URL, ROUTING_URL } from "./model";

const ADDRESS = "12 Harbour Street, Haymarket NSW 2000";
const HOME = { lat: -33.876543, lon: 151.203217 };
const TITLE = "Get moleskine notebooks from officeworks";

const outside = setupServer();

const shop = (id: number, lat: number, lon: number, suburb: string) => ({
  type: "node",
  id,
  lat,
  lon,
  tags: { name: "Officeworks", brand: "Officeworks", "addr:suburb": suburb },
});

const BRANCHES = [shop(1, -33.9, 151.15, "Lewisham"), shop(2, -33.88, 151.205, "Ultimo"), shop(4, -33.87, 151.21, "Sydney")];

const world = ({ trip = 0.93, place = "officeworks", elements = BRANCHES as unknown[] } = {}) => {
  outside.resetHandlers(
    http.get(NOMINATIM_URL, () =>
      HttpResponse.json([
        { lat: String(HOME.lat), lon: String(HOME.lon), display_name: "12, Harbour Street, Haymarket", address: { house_number: "12", road: "Harbour Street", suburb: "Haymarket" } },
      ]),
    ),
    http.post(DECISIONS_URL, async ({ request }) => {
      if (!(await request.text()).includes("needs_trip")) return HttpResponse.json({ error: { message: "not this test" } }, { status: 503 });
      return HttpResponse.json({
        model: "gpt-6-luna",
        answers: [
          { type: "predicate", name: "needs_trip", probability: trip },
          { type: "choice", name: "place", choice: place, confidence: 0.9, probabilities: [] },
        ],
      });
    }),
    http.post(OVERPASS_URL, () => HttpResponse.json({ elements })),
    http.get(`${ROUTING_URL}/:profile/table/v1/driving/:points`, ({ params }) => {
      const seconds = String(params.points)
        .split(";")
        .map((_, index) => (index === 0 ? 0 : index === 2 ? 300 : 600 + index * 60));
      return HttpResponse.json({ code: "Ok", durations: [seconds], distances: [seconds.map((value) => value * 8)] });
    }),
  );
};

const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

const placesReady = async (t: Backend) => {
  unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
  unwrap(await t.action(api.places.saved.save, { label: "home", address: ADDRESS }));
};

const newTask = async (t: Backend, title: string) => {
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title }));
  await settle(t);
  return taskId;
};

const outcomeOf = async (t: Backend, taskId: Id<"tasks">) =>
  (await t.run((ctx) =>
    ctx.db
      .query("taskTrips")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique(),
  ))?.outcome;

beforeAll(() => outside.listen({ onUnhandledRequest: "error" }));
afterAll(() => outside.close());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "sk-env");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Saved Places on the wire", () => {
  test("save answers with the place, remove with null, and list with what is saved", async () => {
    const t = await newBackend();
    world();
    expect(await t.query(api.places.saved.list, {})).toStrictEqual([]);
    const saved = await t.action(api.places.saved.save, { label: "home", address: `  ${ADDRESS}  ` });
    expect(saved).toStrictEqual({
      ok: true,
      value: { label: "home", address: ADDRESS, found: "12 Harbour Street, Haymarket", savedAt: expect.any(Number) },
    });
    expect(await t.query(api.places.saved.list, {})).toStrictEqual([
      { label: "home", address: ADDRESS, found: "12 Harbour Street, Haymarket", savedAt: expect.any(Number) },
    ]);
    expect(await t.action(api.places.saved.remove, { label: "home" })).toBeNull();
    expect(await t.query(api.places.saved.list, {})).toStrictEqual([]);
  });

  test.each([
    ["an empty address", () => HttpResponse.json([]), "   ", { kind: "empty" }],
    ["an address the geocoder cannot find", () => HttpResponse.json([]), "Nowhere at all", { kind: "not_found" }],
    ["a geocoder that is unreachable", () => HttpResponse.error(), ADDRESS, { kind: "unreachable" }],
    ["a geocoder that answers 500", () => HttpResponse.json({}, { status: 500 }), ADDRESS, { kind: "unavailable", status: 500 }],
    ["a geocoder that rate limits", () => HttpResponse.json({}, { status: 429 }), ADDRESS, { kind: "unavailable", status: 429 }],
    ["malformed JSON", () => new HttpResponse("{not json", { headers: { "content-type": "application/json" } }), ADDRESS, { kind: "invalid_response" }],
    ["an object instead of a list", () => HttpResponse.json({ error: "Bad" }), ADDRESS, { kind: "invalid_response" }],
    ["a match without coordinates", () => HttpResponse.json([{ lat: "north", lon: "151.2" }]), ADDRESS, { kind: "invalid_response" }],
    ["a match that is not an object", () => HttpResponse.json(["Haymarket"]), ADDRESS, { kind: "invalid_response" }],
  ])("save refuses %s", async (_, answer, address, error) => {
    const t = await newBackend();
    world();
    outside.use(http.get(NOMINATIM_URL, answer));
    expect(await t.action(api.places.saved.save, { label: "home", address })).toStrictEqual({ ok: false, error });
    expect(await t.query(api.places.saved.list, {})).toStrictEqual([]);
  });
});

describe("a Trip on the wire", () => {
  test("a Trip reads as trip, looking, failed, unfound or nothing, and request says whether it asked", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, TITLE);
    const trip = await t.query(api.places.trips.forTask, { taskId });
    expect(trip).toStrictEqual({
      kind: "trip",
      query: "officeworks",
      mode: "drive",
      from: { lat: -33.877, lon: 151.203 },
      chosen: expect.objectContaining({ key: "node/4", name: "Officeworks", suburb: "Sydney", travel: expect.any(Object) }),
      places: expect.any(Array),
    });
    expect(await t.mutation(api.places.trips.request, { taskId })).toStrictEqual({ requested: false });
    world({ trip: 0.08, place: "no particular place" });
    expect(await t.query(api.places.trips.forTask, { taskId: await newTask(t, "Email the tutor") })).toBeNull();

    world({ place: "a post office", elements: [] });
    const parcel = await newTask(t, "Post the parcel to Mum");
    expect(await t.query(api.places.trips.forTask, { taskId: parcel })).toStrictEqual({ kind: "unfound", query: "a post office", mode: "drive" });
    expect(await outcomeOf(t, parcel)).toStrictEqual({
      kind: "unfound",
      query: "a post office",
      mode: "drive",
      from: { lat: -33.877, lon: 151.203 },
      inputsHash: expect.any(String),
      at: expect.any(Number),
      answeredBy: expect.any(String),
    });

    world();
    outside.use(http.post(OVERPASS_URL, () => HttpResponse.json({}, { status: 503 })));
    const failed = await newTask(t, "Get notebooks from officeworks");
    expect(await t.query(api.places.trips.forTask, { taskId: failed })).toStrictEqual({ kind: "failed", query: "officeworks" });
    world();
    expect(await t.mutation(api.places.trips.request, { taskId: failed })).toStrictEqual({ requested: true });
    expect(await t.query(api.places.trips.forTask, { taskId: failed })).toStrictEqual({
      kind: "looking",
      query: "officeworks",
      since: expect.any(Number),
    });
  });

  test("choose and dismiss answer with the change and its Activity, and refuse a Task without a Trip or a place that was not found", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, TITLE);
    expect(await t.mutation(api.places.trips.choose, { taskId, key: "node/999" })).toStrictEqual({ ok: false, error: { kind: "unknown_place" } });
    expect(await t.mutation(api.places.trips.choose, { taskId, key: "node/1" })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: expect.any(String) },
    });
    expect(await t.mutation(api.places.trips.dismiss, { taskId })).toStrictEqual({
      ok: true,
      value: { changed: true, activityId: expect.any(String) },
    });
    world({ trip: 0.08, place: "no particular place" });
    const none = await newTask(t, "Email the tutor");
    expect(await t.mutation(api.places.trips.choose, { taskId: none, key: "node/1" })).toStrictEqual({ ok: false, error: { kind: "no_trip" } });
    expect(await t.mutation(api.places.trips.dismiss, { taskId: none })).toStrictEqual({ ok: false, error: { kind: "no_trip" } });
  });

  test("a Task that needs no trip is stored as none", async () => {
    const t = await newBackend();
    world({ trip: 0.08, place: "no particular place" });
    await placesReady(t);
    const taskId = await newTask(t, "Email the tutor about the essay");
    expect(await outcomeOf(t, taskId)).toStrictEqual({ kind: "none", inputsHash: expect.any(String), at: expect.any(Number), answeredBy: expect.any(String) });
  });
});

const failed = (error: object) => ({
  kind: "failed",
  error,
  query: "officeworks",
  inputsHash: expect.any(String),
  at: expect.any(Number),
});

describe("a failed Trip is stored as the error the apps read", () => {
  test.each([
    ["is rate limited", () => HttpResponse.json({}, { status: 429 }), { kind: "rate_limited" }],
    ["refuses the request", () => HttpResponse.json({}, { status: 403 }), { kind: "unauthorised" }],
    ["answers 401", () => HttpResponse.json({}, { status: 401 }), { kind: "unauthorised" }],
    ["answers 503", () => HttpResponse.json({}, { status: 503 }), { kind: "unavailable", status: 503 }],
    ["is unreachable", () => HttpResponse.error(), { kind: "unavailable" }],
    ["sends malformed JSON", () => new HttpResponse("<html>", { headers: { "content-type": "application/json" } }), { kind: "invalid_response" }],
    ["sends no elements", () => HttpResponse.json({ remark: "nothing" }), { kind: "invalid_response" }],
    ["gives up on the query", () => HttpResponse.json({ elements: [], remark: "runtime error: Query timed out" }), { kind: "unavailable" }],
  ])("a search that %s", async (_, answer, error) => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.post(OVERPASS_URL, answer));
    const taskId = await newTask(t, TITLE);
    expect(await outcomeOf(t, taskId)).toStrictEqual(failed(error));
  });

  test.each([
    ["a refusal", { answers: [{ type: "refusal", name: "needs_trip", refusal: "No." }] }, { kind: "refused" }],
    ["no answers", { model: "gpt-6-luna" }, { kind: "invalid_response" }],
    ["a predicate without odds", { answers: [{ type: "predicate", name: "needs_trip" }] }, { kind: "invalid_response" }],
  ])("a model that sends %s", async (_, answer, error) => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(
      http.post(DECISIONS_URL, async ({ request }) =>
        (await request.text()).includes("needs_trip") ? HttpResponse.json(answer) : HttpResponse.json({}, { status: 503 }),
      ),
    );
    const taskId = await newTask(t, TITLE);
    expect(await t.query(api.places.trips.forTask, { taskId })).toBeNull();
    const { query: _query, ...withoutQuery } = failed(error);
    expect(await outcomeOf(t, taskId)).toStrictEqual(withoutQuery);
  });

  test("when routing fails the branches are kept without a travel time", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.get(`${ROUTING_URL}/:profile/table/v1/driving/:points`, () => HttpResponse.json({ code: "InvalidQuery" }, { status: 400 })));
    const taskId = await newTask(t, TITLE);
    const outcome = await outcomeOf(t, taskId);
    expect(outcome).toMatchObject({ kind: "found", query: "officeworks" });
    expect(outcome?.kind === "found" && outcome.places.map(({ key, travel }) => [key, travel])).toStrictEqual([
      ["node/2", undefined],
      ["node/4", undefined],
      ["node/1", undefined],
    ]);
  });
});

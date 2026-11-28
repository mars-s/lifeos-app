import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DECISIONS_URL, newAiBackend as newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";
import { Result } from "effect";
import { wireError } from "../../shared/result";
import { kindOf, nearestPlaces, NOMINATIM_URL, OVERPASS_URL, overpassQuery, placePhrases, ROUTING_URL } from "./model";

const failureOf = (result: ReturnType<typeof nearestPlaces>) => (Result.isFailure(result) ? wireError(result.failure) : undefined);

const successOf = (result: ReturnType<typeof nearestPlaces>) => (Result.isSuccess(result) ? result.success : undefined);

const ADDRESS = "12 Harbour Street, Haymarket NSW 2000";
const HOME = { lat: -33.876543, lon: 151.203217 };
const SENT_HOME = { lat: -33.877, lon: 151.203 };

type Seen = { url: string; body: string };

const outside = setupServer();

const shop = (id: number, name: string, lat: number, lon: number, suburb?: string) => ({
  type: "node",
  id,
  lat,
  lon,
  tags: { name, brand: "Officeworks", ...(suburb ? { "addr:suburb": suburb } : {}) },
});

const OFFICEWORKS = [
  shop(1, "Officeworks", -33.9, 151.15, "Lewisham"),
  shop(2, "Officeworks", -33.88, 151.205, "Ultimo"),
  { type: "way", id: 3, center: { lat: -33.79, lon: 151.18 }, tags: { name: "Officeworks", branch: "Chatswood" } },
  shop(4, "Officeworks", -33.87, 151.21, "Sydney"),
  shop(5, "Officeworks", -33.95, 151.1, "Bankstown"),
  shop(6, "Officeworks", -33.92, 151.24, "Kingsford"),
  { type: "node", id: 7, lat: -33.88, lon: 151.2, tags: {} },
];

const world = ({
  trip = 0.93,
  place = "officeworks",
  elements = OFFICEWORKS as unknown[],
  geocoded = [{ lat: String(HOME.lat), lon: String(HOME.lon), display_name: "12, Harbour Street, Haymarket", address: { house_number: "12", road: "Harbour Street", suburb: "Haymarket" } }] as unknown[],
} = {}) => {
  const seen: Seen[] = [];
  const counts = { nominatim: 0, decisions: 0, overpass: 0, routing: 0 };
  outside.resetHandlers(
    http.get(NOMINATIM_URL, ({ request }) => {
      counts.nominatim += 1;
      seen.push({ url: request.url, body: "" });
      return HttpResponse.json(geocoded);
    }),
    http.post(DECISIONS_URL, async ({ request }) => {
      const body = await request.text();
      seen.push({ url: request.url, body });
      if (!body.includes("needs_trip")) return HttpResponse.json({ error: { message: "not this test" } }, { status: 503 });
      counts.decisions += 1;
      return HttpResponse.json({
        model: "gpt-6-luna",
        answers: [
          { type: "predicate", name: "needs_trip", probability: trip },
          { type: "choice", name: "place", choice: place, confidence: 0.9, probabilities: [] },
        ],
      });
    }),
    http.post(OVERPASS_URL, async ({ request }) => {
      counts.overpass += 1;
      seen.push({ url: request.url, body: await request.text() });
      return HttpResponse.json({ elements });
    }),
    http.get(`${ROUTING_URL}/:profile/table/v1/driving/:points`, ({ request, params }) => {
      counts.routing += 1;
      seen.push({ url: request.url, body: "" });
      const points = String(params.points).split(";");
      const seconds = points.map((_, index) => (index === 0 ? 0 : index === 2 ? 300 : 600 + index * 60));
      return HttpResponse.json({ code: "Ok", durations: [seconds], distances: [seconds.map((value) => value * 8)] });
    }),
  );
  return { seen, counts };
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

const tripOf = (t: Backend, taskId: Id<"tasks">) => t.query(api.places.trips.forTask, { taskId });

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

describe("place phrases", () => {
  test("come from the title without verbs or small words, and a known kind maps to its tags", () => {
    expect(placePhrases("Get moleskine notebooks from officeworks")).toEqual([
      "moleskine",
      "moleskine notebooks",
      "notebooks",
      "notebooks from officeworks",
      "officeworks",
    ]);
    expect(kindOf("Chemist")?.value).toBe("a pharmacy");
    expect(kindOf("a post office")?.filters).toEqual([`"amenity"="post_office"`]);
    expect(kindOf("officeworks")).toBeUndefined();
  });
});

describe("searching for a brand", () => {
  test("asks for the brand and name exactly in common casings first, and only shops and amenities by pattern", () => {
    const query = overpassQuery("officeworks", HOME);
    expect(query).toContain(`["brand"="Officeworks"]`);
    expect(query).toContain(`["name"="Officeworks"]`);
    expect(query).toContain(`["brand"="officeworks"]`);
    expect(query).toContain(`["shop"]["name"~"officeworks",i]`);
    expect(query).not.toContain(`nwr["name"~`);
    expect(query).not.toContain(`nwr["brand"~`);
  });

  test("a search Overpass gave up on is a failure to retry, not an empty street", () => {
    const timedOut = { elements: [], remark: "runtime error: Query timed out in \"query\" at line 1 after 21 seconds." };
    expect(failureOf(nearestPlaces(timedOut, HOME))).toEqual({ kind: "unavailable" });
    expect(successOf(nearestPlaces({ elements: [] }, HOME))).toEqual([]);
  });
});

describe("Saved Places", () => {
  test("an address is geocoded once, and the same address again reuses the stored coordinates", async () => {
    const t = await newBackend();
    const { counts } = world();
    expect(unwrap(await t.action(api.places.saved.save, { label: "home", address: ADDRESS }))).toMatchObject({
      label: "home",
      address: ADDRESS,
      found: "12 Harbour Street, Haymarket",
    });
    unwrap(await t.action(api.places.saved.save, { label: "work", address: "  12 harbour street,   HAYMARKET nsw 2000 " }));
    unwrap(await t.action(api.places.saved.save, { label: "home", address: ADDRESS }));
    expect(counts.nominatim).toBe(1);
    expect((await t.query(api.places.saved.list, {})).map(({ label }) => label).toSorted()).toEqual(["home", "work"]);
  });

  test("an empty address or one the geocoder cannot find is refused and nothing is stored", async () => {
    const t = await newBackend();
    world({ geocoded: [] });
    expect(await t.action(api.places.saved.save, { label: "home", address: "   " })).toEqual({ ok: false, error: { kind: "empty" } });
    expect(await t.action(api.places.saved.save, { label: "home", address: "Nowhere at all" })).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(await t.query(api.places.saved.list, {})).toEqual([]);
  });

  test("saving and removing an address leaves nothing in Activity", async () => {
    const t = await newBackend();
    world();
    unwrap(await t.action(api.places.saved.save, { label: "home", address: ADDRESS }));
    await t.action(api.places.saved.remove, { label: "home" });
    const history = await t.run(async (ctx) => JSON.stringify(await ctx.db.query("activityChanges").collect()));
    expect(history).not.toContain("Harbour");
    expect(await t.query(api.places.saved.list, {})).toEqual([]);
  });
});

describe("finding a Trip", () => {
  test("the nearest branch by travel time comes first, with distance and travel time, and only five are kept", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    const trip = await tripOf(t, taskId);
    expect(trip).toMatchObject({ kind: "trip", query: "officeworks", mode: "drive", from: SENT_HOME });
    if (trip?.kind !== "trip") throw new Error("expected a Trip");
    expect(trip.places).toHaveLength(5);
    expect(trip.chosen).toMatchObject({ key: "node/4", name: "Officeworks", suburb: "Sydney", travel: { seconds: 300, metres: 2400 } });
    expect(trip.places.map((place) => place.key)).not.toContain("node/5");
  });

  test("the Travel Mode picks the routing profile, and changing it finds the time again when the card opens", async () => {
    const t = await newBackend();
    const { seen } = world();
    await placesReady(t);
    unwrap(await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } }));
    const taskId = await newTask(t, "Pick up prints at Officeworks");
    expect(seen.filter(({ url }) => url.startsWith(ROUTING_URL)).map(({ url }) => new URL(url).pathname.split("/")[1])).toEqual(["routed-foot"]);
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });

    unwrap(await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "cycle" } } }));
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    expect(await tripOf(t, taskId)).toMatchObject({ mode: "cycle" });
    expect(seen.filter(({ url }) => url.startsWith(ROUTING_URL)).at(-1)?.url).toContain("/routed-bike/");
  });

  test("a Task that needs no trip searches for nothing and shows nothing", async () => {
    const t = await newBackend();
    const { counts } = world({ trip: 0.08, place: "no particular place" });
    await placesReady(t);
    const taskId = await newTask(t, "Email the tutor about the essay");
    expect(counts).toMatchObject({ decisions: 1, overpass: 0, routing: 0 });
    expect(await tripOf(t, taskId)).toBeNull();
  });

  test("a kind of place is searched by its tags, and nothing nearby says so", async () => {
    const t = await newBackend();
    const { seen } = world({ place: "a post office", elements: [] });
    await placesReady(t);
    const taskId = await newTask(t, "Post the parcel to Mum");
    expect(decodeURIComponent(seen.find(({ url }) => url === OVERPASS_URL)?.body ?? "")).toContain(`["amenity"="post_office"]`);
    expect(await tripOf(t, taskId)).toEqual({ kind: "unfound", query: "a post office", mode: "drive" });
  });

  test("while the search runs the Trip names the place it is looking for", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const during: unknown[] = [];
    let looked: Id<"tasks"> | undefined;
    outside.use(
      http.post(OVERPASS_URL, async () => {
        if (looked) during.push(await tripOf(t, looked));
        return HttpResponse.json({ elements: OFFICEWORKS });
      }),
    );
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Get moleskine notebooks from officeworks" }));
    looked = taskId;
    expect(await tripOf(t, taskId)).toBeNull();
    await settle(t);
    expect(during).toEqual([{ kind: "looking", query: "officeworks", since: expect.any(Number) }]);
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", query: "officeworks" });
  });

  test("a search that fails says so, and asking again looks at once", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.post(OVERPASS_URL, () => HttpResponse.json({}, { status: 503 })));
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toEqual({ kind: "failed", query: "officeworks" });

    world();
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "looking", query: "officeworks" });
    await settle(t);
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", query: "officeworks" });
  });

  test("a model that does not answer shows nothing, because no trip is known yet", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.post(DECISIONS_URL, () => HttpResponse.json({ error: { message: "down" } }, { status: 503 })));
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toBeNull();
  });

  test("the same title asks nothing again", async () => {
    const t = await newBackend();
    const { counts } = world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Get notebooks" }));
    unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Get moleskine notebooks from officeworks" }));
    await settle(t);
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
    expect(counts.decisions).toBe(1);
  });

  test("with Places off, or no Home yet, nothing is sent anywhere", async () => {
    const t = await newBackend();
    const { counts } = world();
    await newTask(t, "Get moleskine notebooks from officeworks");
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    await newTask(t, "Pick up prints at Officeworks");
    expect(counts).toEqual({ nominatim: 0, decisions: 0, overpass: 0, routing: 0 });
  });

  test("picking another branch and dismissing both undo", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    const picked = unwrap(await t.mutation(api.places.trips.choose, { taskId, key: "way/3" }));
    expect(await tripOf(t, taskId)).toMatchObject({ chosen: { key: "way/3", suburb: "Chatswood" } });
    expect(await t.mutation(api.places.trips.choose, { taskId, key: "node/999" })).toEqual({ ok: false, error: { kind: "unknown_place" } });

    const dismissed = unwrap(await t.mutation(api.places.trips.dismiss, { taskId }));
    expect(await tripOf(t, taskId)).toBeNull();
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: dismissed.activityId! }));
    expect(await tripOf(t, taskId)).toMatchObject({ chosen: { key: "way/3" } });
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: picked.activityId! }));
    expect(await tripOf(t, taskId)).toMatchObject({ chosen: { key: "node/4" } });
  });
});

describe("privacy", () => {
  test("the full address goes only to the geocoder, and everyone else gets Home rounded to about 100 m", async () => {
    const t = await newBackend();
    const { seen } = world();
    await placesReady(t);
    await newTask(t, "Get moleskine notebooks from officeworks");
    const sent = seen.map(({ url, body }) => ({ url, text: decodeURIComponent(`${url} ${body}`.replace(/\+/g, " ")) }));
    const withAddress = sent.filter(({ text }) => text.includes("Harbour"));
    expect(withAddress.map(({ url }) => new URL(url).origin)).toEqual([new URL(NOMINATIM_URL).origin]);
    for (const request of sent.filter(({ url }) => !url.startsWith(NOMINATIM_URL))) {
      expect(request.text, request.url).not.toContain(String(HOME.lat));
      expect(request.text, request.url).not.toContain(String(HOME.lon));
    }
    const decisions = sent.find(({ url }) => url === DECISIONS_URL)?.text ?? "";
    expect(decisions).not.toContain(String(SENT_HOME.lat));
    expect(sent.find(({ url }) => url === OVERPASS_URL)?.text).toContain(`${SENT_HOME.lat},${SENT_HOME.lon}`);
    expect(sent.find(({ url }) => url.startsWith(ROUTING_URL))?.url).toContain(`${SENT_HOME.lon},${SENT_HOME.lat}`);
  });
});

describe("only Avi", () => {
  test("cannot be read or changed by anyone else", async () => {
    world();
    const signedOut = newSignedOutBackend();
    await expect(signedOut.query(api.places.saved.list, {})).rejects.toThrow(/Sign in/);
    await expect(signedOut.action(api.places.saved.save, { label: "home", address: ADDRESS })).rejects.toThrow(/Sign in/);
    const stranger = await strangerSession(newSignedOutBackend());
    await expect(stranger.query(api.places.saved.list, {})).rejects.toThrow(/not your LifeOS/);
    await expect(stranger.action(api.places.saved.remove, { label: "home" })).rejects.toThrow(/not your LifeOS/);
    const taskId = await stranger.run((ctx) =>
      ctx.db.insert("tasks", { title: "x", notes: "", when: { kind: "anytime" }, parent: { kind: "loose" }, labelIds: [], status: { kind: "open" }, order: "a0" }),
    );
    await expect(stranger.query(api.places.trips.forTask, { taskId })).rejects.toThrow(/not your LifeOS/);
    await expect(stranger.mutation(api.places.trips.dismiss, { taskId })).rejects.toThrow(/not your LifeOS/);
  });
});

const tripRow = (t: Backend, taskId: Id<"tasks">) =>
  t.run((ctx) =>
    ctx.db
      .query("taskTrips")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .unique(),
  );

describe("Saved Places when the geocoder fails", () => {
  test.each([
    ["is unreachable", () => HttpResponse.error(), { kind: "unreachable" }],
    ["answers 500", () => HttpResponse.json({}, { status: 500 }), { kind: "unavailable", status: 500 }],
    ["rate limits", () => HttpResponse.json({}, { status: 429 }), { kind: "unavailable", status: 429 }],
    ["sends malformed JSON", () => new HttpResponse("{not json", { headers: { "content-type": "application/json" } }), { kind: "invalid_response" }],
    ["sends an object instead of a list", () => HttpResponse.json({ error: "Bad" }), { kind: "invalid_response" }],
    ["sends a match without coordinates", () => HttpResponse.json([{ lat: "north", lon: "151.2" }]), { kind: "invalid_response" }],
    ["sends a match that is not an object", () => HttpResponse.json(["Haymarket"]), { kind: "invalid_response" }],
  ])("a geocoder that %s is a typed error and nothing is stored", async (_, answer, error) => {
    const t = await newBackend();
    world();
    outside.use(http.get(NOMINATIM_URL, answer));
    expect(await t.action(api.places.saved.save, { label: "home", address: ADDRESS })).toEqual({ ok: false, error });
    expect(await t.query(api.places.saved.list, {})).toEqual([]);
  });

  test("forgetting a place that was never saved changes nothing, and forgetting Home makes Places ask for it again", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    expect(await t.action(api.places.saved.remove, { label: "uni" })).toBeNull();
    expect((await t.query(api.places.saved.list, {})).map(({ label }) => label)).toEqual(["home"]);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip" });

    await t.action(api.places.saved.remove, { label: "home" });
    const places = (await t.query(api.platform.features.list, {})).find(({ feature }) => feature === "places");
    expect(places?.status).toEqual({ kind: "needs_setup", setup: "home" });
    expect(await tripOf(t, taskId)).toBeNull();
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
  });
});

describe("a Trip when a provider fails", () => {
  test.each([
    ["is rate limited", () => HttpResponse.json({}, { status: 429 }), { kind: "rate_limited" }],
    ["refuses the request", () => HttpResponse.json({}, { status: 403 }), { kind: "unauthorised" }],
    ["is unreachable", () => HttpResponse.error(), { kind: "unavailable" }],
    ["sends malformed JSON", () => new HttpResponse("<html>", { headers: { "content-type": "application/json" } }), { kind: "invalid_response" }],
    ["sends no elements", () => HttpResponse.json({ remark: "nothing" }), { kind: "invalid_response" }],
  ])("a search that %s fails with a typed error and names the place it looked for", async (_, answer, error) => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.post(OVERPASS_URL, answer));
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toEqual({ kind: "failed", query: "officeworks" });
    expect((await tripRow(t, taskId))?.outcome).toMatchObject({ kind: "failed", error });
  });

  test.each([
    ["a refusal", { answers: [{ type: "refusal", name: "needs_trip", refusal: "No." }] }, { kind: "refused" }],
    ["no answers", { model: "gpt-6-luna" }, { kind: "invalid_response" }],
    ["a list", [], { kind: "invalid_response" }],
    ["a predicate without odds", { answers: [{ type: "predicate", name: "needs_trip" }] }, { kind: "invalid_response" }],
  ])("a model that sends %s is a typed failure and no search is made", async (_, answer, error) => {
    const t = await newBackend();
    const { counts } = world();
    await placesReady(t);
    outside.use(
      http.post(DECISIONS_URL, async ({ request }) =>
        (await request.text()).includes("needs_trip") ? HttpResponse.json(answer) : HttpResponse.json({}, { status: 503 }),
      ),
    );
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toBeNull();
    expect((await tripRow(t, taskId))?.outcome).toMatchObject({ kind: "failed", error });
    expect(counts.overpass).toBe(0);
  });

  test("when routing fails the nearest branches are still shown, by straight-line distance and without a travel time", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.get(`${ROUTING_URL}/:profile/table/v1/driving/:points`, () => HttpResponse.json({ code: "InvalidQuery" }, { status: 400 })));
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    const trip = await tripOf(t, taskId);
    if (trip?.kind !== "trip") throw new Error("expected a Trip");
    expect(trip.chosen).toMatchObject({ key: "node/2", suburb: "Ultimo" });
    expect(trip.chosen.travel).toBeUndefined();
    expect(trip.places.map((place) => place.straightMetres)).toEqual(trip.places.map((place) => place.straightMetres).toSorted((a, b) => a - b));
  });

  test("routing that answers Ok without a duration table keeps the branches without travel time", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    outside.use(http.get(`${ROUTING_URL}/:profile/table/v1/driving/:points`, () => HttpResponse.json({ code: "Ok", durations: [] })));
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", chosen: { key: "node/2" } });
  });

  test("elements without a name or a position are left out", () => {
    const body = {
      elements: [
        null,
        { type: "node", id: 1, lat: -33.88, lon: 151.2 },
        { type: "node", id: 2, tags: { name: "No position" } },
        { type: "node", id: "3", lat: -33.88, lon: 151.2, tags: { name: "Odd id" } },
        { type: "node", id: 4, lat: -33.88, lon: 151.2, tags: { brand: "Officeworks", "addr:city": "Officeworks" } },
      ],
    };
    expect(successOf(nearestPlaces(body, HOME))).toEqual([
      { key: "node/4", name: "Officeworks", position: { lat: -33.88, lon: 151.2 }, straightMetres: expect.any(Number) },
    ]);
    expect(failureOf(nearestPlaces([], HOME))).toEqual({ kind: "invalid_response" });
  });
});

describe("a Trip when the Task changes under it", () => {
  test("a Task renamed while the model is answering gets the Trip for its new title, not the old one", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    let taskId: Id<"tasks"> | undefined;
    const asked: string[] = [];
    outside.use(
      http.post(DECISIONS_URL, async ({ request }) => {
        const body = await request.text();
        if (!body.includes("needs_trip")) return HttpResponse.json({}, { status: 503 });
        asked.push(body);
        if (asked.length === 1 && taskId) unwrap(await t.mutation(api.planner.tasks.rename, { taskId, title: "Buy paint at Bunnings" }));
        const place = body.includes("Bunnings") ? "Bunnings" : "officeworks";
        return HttpResponse.json({ answers: [{ type: "predicate", name: "needs_trip", probability: 0.9 }, { type: "choice", name: "place", choice: place }] });
      }),
    );
    taskId = unwrap(await t.mutation(api.planner.tasks.create, { title: "Get moleskine notebooks from officeworks" })).taskId;
    await settle(t);
    expect(asked).toHaveLength(2);
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", query: "Bunnings" });
  });

  test("a Task deleted before its lookup runs leaves no Trip behind and asks nothing", async () => {
    const t = await newBackend();
    const { counts } = world();
    await placesReady(t);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Get moleskine notebooks from officeworks" }));
    await t.run((ctx) => ctx.db.delete("tasks", taskId));
    await settle(t);
    expect(counts.decisions).toBe(0);
    expect(await tripRow(t, taskId)).toBeNull();
  });

  test("a Task trashed or completed before its lookup runs asks nothing, and asking again is refused", async () => {
    const t = await newBackend();
    const { counts } = world();
    await placesReady(t);
    const trashed = unwrap(await t.mutation(api.planner.tasks.create, { title: "Get moleskine notebooks from officeworks" })).taskId;
    const done = unwrap(await t.mutation(api.planner.tasks.create, { title: "Pick up prints at Officeworks" })).taskId;
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId: trashed }));
    unwrap(await t.mutation(api.planner.tasks.complete, { taskId: done }));
    await settle(t);
    expect(counts.decisions).toBe(0);
    expect(await tripOf(t, trashed)).toBeNull();
    expect(await t.mutation(api.places.trips.request, { taskId: trashed })).toEqual({ requested: false });
    expect(await t.mutation(api.places.trips.request, { taskId: done })).toEqual({ requested: false });
  });

  test("a lookup stuck for over a minute is asked again when the card opens, and only the newest run answers", async () => {
    const t = await newBackend();
    const { counts } = world();
    await placesReady(t);
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Get moleskine notebooks from officeworks" }));
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
    vi.setSystemTime(Date.now() + 61_000);
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    expect(counts.decisions).toBe(1);
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", query: "officeworks" });
  });

  test("moving Home finds the Trip again from the new Home when the card opens", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    outside.use(http.get(NOMINATIM_URL, () => HttpResponse.json([{ lat: "-33.8", lon: "151.18", display_name: "Chatswood, Sydney" }])));
    expect(unwrap(await t.action(api.places.saved.save, { label: "home", address: "Chatswood" }))).toMatchObject({ found: "Chatswood, Sydney" });
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    const trip = await tripOf(t, taskId);
    if (trip?.kind !== "trip") throw new Error("expected a Trip");
    expect(trip.from).toEqual({ lat: -33.8, lon: 151.18 });
    expect(trip.places.toSorted((a, b) => a.straightMetres - b.straightMetres)[0]?.suburb).toBe("Chatswood");
  });

  test("a place found nowhere nearby is looked for again once Home moves", async () => {
    const t = await newBackend();
    world({ place: "a post office", elements: [] });
    await placesReady(t);
    const taskId = await newTask(t, "Post the parcel to Mum");
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
    outside.use(http.get(NOMINATIM_URL, () => HttpResponse.json([{ lat: "-33.8", lon: "151.18", display_name: "Chatswood" }])));
    unwrap(await t.action(api.places.saved.save, { label: "home", address: "Chatswood" }));
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
  });
});

describe("choosing a Trip place", () => {
  test("with no Trip found there is nothing to choose or dismiss", async () => {
    const t = await newBackend();
    world({ trip: 0.05, place: "no particular place" });
    await placesReady(t);
    const taskId = await newTask(t, "Email the tutor about the essay");
    expect(await t.mutation(api.places.trips.choose, { taskId, key: "node/4" })).toEqual({ ok: false, error: { kind: "no_trip" } });
    expect(await t.mutation(api.places.trips.dismiss, { taskId })).toEqual({ ok: false, error: { kind: "no_trip" } });
  });

  test("choosing the branch already chosen records nothing, and the chosen branch survives a new search for the same place", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    unwrap(await t.mutation(api.places.trips.choose, { taskId, key: "way/3" }));
    expect(unwrap(await t.mutation(api.places.trips.choose, { taskId, key: "way/3" }))).toEqual({ changed: false, activityId: null });

    unwrap(await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } }));
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: true });
    await settle(t);
    expect(await tripOf(t, taskId)).toMatchObject({ mode: "walk", chosen: { key: "way/3" } });
  });

  test("a Trip is hidden while Places is off and comes back as it was when Places is on again", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    unwrap(await t.mutation(api.places.trips.choose, { taskId, key: "way/3" }));
    const off = unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: false }));
    expect(await tripOf(t, taskId)).toBeNull();
    expect(await t.mutation(api.places.trips.request, { taskId })).toEqual({ requested: false });
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: off.activityId! }));
    expect(await tripOf(t, taskId)).toMatchObject({ kind: "trip", chosen: { key: "way/3" } });
  });
});

describe("a Task deleted forever", () => {
  test("takes its Trip row with it", async () => {
    const t = await newBackend();
    world();
    await placesReady(t);
    const taskId = await newTask(t, "Get moleskine notebooks from officeworks");
    expect(await tripRow(t, taskId)).not.toBeNull();
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId }));
    unwrap(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: taskId }] }));
    expect(await tripRow(t, taskId)).toBeNull();
  });
});

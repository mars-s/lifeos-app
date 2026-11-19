import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DECISIONS_URL, newAiBackend as newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";
import { kindOf, nearestPlaces, NOMINATIM_URL, OVERPASS_URL, overpassQuery, placePhrases, ROUTING_URL } from "./model";

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
    expect(nearestPlaces(timedOut, HOME)._unsafeUnwrapErr()).toEqual({ kind: "unavailable" });
    expect(nearestPlaces({ elements: [] }, HOME)._unsafeUnwrap()).toEqual([]);
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

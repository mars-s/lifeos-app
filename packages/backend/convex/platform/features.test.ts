import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { newBackend, newSignedOutBackend, strangerSession, unwrap, type Backend } from "../backend.test-utils";

const stateOf = async (t: Backend, feature: string) => (await t.query(api.platform.features.list, {})).find((state) => state.feature === feature);

const saveHome = (t: Backend) =>
  t.run((ctx) =>
    ctx.db.insert("savedPlaces", { label: "home", address: "1 Example St", position: { lat: -33.87, lon: 151.21 }, found: "Example St", savedAt: 1 }),
  );

beforeEach(() => vi.stubEnv("OPENAI_API_KEY", "sk-env"));
afterEach(() => vi.unstubAllEnvs());

describe("the Feature registry", () => {
  test("before Avi touches anything, each Feature takes its registry default and says what it needs", async () => {
    const t = await newBackend();
    expect(await t.query(api.platform.features.list, {})).toEqual([
      { feature: "ai", enabled: false, settings: { routes: {} }, status: { kind: "off" } },
      { feature: "places", enabled: false, settings: { travelMode: "drive" }, status: { kind: "off" } },
      { feature: "templates", enabled: true, settings: {}, status: { kind: "ready" } },
    ]);
    expect(await t.run(async (ctx) => ctx.db.query("features").collect())).toEqual([]);
  });

  test("a Feature switched on says which key, Feature or setup is missing until it is there", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const t = await newBackend();
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "ai", enabled: true }));
    expect((await stateOf(t, "ai"))?.status).toEqual({ kind: "needs_key" });
    expect((await stateOf(t, "places"))?.status).toEqual({ kind: "needs_feature", feature: "ai" });

    vi.stubEnv("OPENCODE_GO_API_KEY", "go-env");
    expect((await stateOf(t, "ai"))?.status).toEqual({ kind: "ready" });
    expect((await stateOf(t, "places"))?.status).toEqual({ kind: "needs_setup", setup: "home" });

    await saveHome(t);
    expect((await stateOf(t, "places"))?.status).toEqual({ kind: "ready" });

    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "ai", enabled: false }));
    expect((await stateOf(t, "places"))?.status).toEqual({ kind: "needs_feature", feature: "ai" });
  });

  test("switching and configuring land in Activity and undo back to the defaults", async () => {
    const t = await newBackend();
    const on = unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true }));
    const walk = unwrap(
      await t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } }),
    );
    expect(await stateOf(t, "places")).toMatchObject({ enabled: true, settings: { travelMode: "walk" } });

    unwrap(await t.mutation(api.platform.undo.undo, { activityId: walk.activityId! }));
    expect(await stateOf(t, "places")).toMatchObject({ enabled: true, settings: { travelMode: "drive" } });
    unwrap(await t.mutation(api.platform.undo.undo, { activityId: on.activityId! }));
    expect(await stateOf(t, "places")).toMatchObject({ enabled: false, settings: { travelMode: "drive" } });
  });

  test("the same switch twice records nothing the second time", async () => {
    const t = await newBackend();
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "templates", enabled: false }));
    expect(unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "templates", enabled: false }))).toEqual({
      changed: false,
      activityId: null,
    });
  });

  test("settings are validated by the Feature's own validator", async () => {
    const t = await newBackend();
    await expect(
      t.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "train" } } } as never),
    ).rejects.toThrow(/travelMode/);
    await expect(
      t.mutation(api.platform.features.configure, { choice: { feature: "templates", settings: { travelMode: "walk" } } } as never),
    ).rejects.toThrow(/travelMode/);
  });

  test("only Avi can read or change Features", async () => {
    const signedOut = newSignedOutBackend();
    await expect(signedOut.query(api.platform.features.list, {})).rejects.toThrow(/Sign in/);
    await expect(signedOut.mutation(api.platform.features.setEnabled, { feature: "places", enabled: true })).rejects.toThrow(/Sign in/);
    const stranger = await strangerSession(newSignedOutBackend());
    await expect(stranger.query(api.platform.features.list, {})).rejects.toThrow(/not your LifeOS/);
    await expect(
      stranger.mutation(api.platform.features.configure, { choice: { feature: "places", settings: { travelMode: "walk" } } }),
    ).rejects.toThrow(/not your LifeOS/);
  });
});

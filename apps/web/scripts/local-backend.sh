#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="${SCRATCH:-${TMPDIR:-/tmp}/lifeos-local-backend}"
OWNER_ID=1001

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cp -R "$ROOT/packages/backend/convex" "$ROOT/packages/backend/shared" "$ROOT/packages/backend/package.json" "$SCRATCH/"
ln -s "$ROOT/packages/backend/node_modules" "$SCRATCH/node_modules"

cat > "$SCRATCH/convex/scratch.ts" <<'SCRATCH_TS'
import { createFunctionHandle } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { localIsoDate } from "../shared/date";
import { activeSession } from "./planner/focus";
import { seedPlanner } from "./planner/seed.test-utils";
import { seedTimebox } from "./planner/planSeed.test-utils";
import { seedSleep } from "./health/sleepSeed.test-utils";
import { addDays, parseIsoDate } from "../shared/date";
import { generateNKeysBetween } from "fractional-indexing";
import { zonedMoment } from "./calendar/model";

const SEEDED = [
  "areas",
  "projects",
  "headings",
  "labels",
  "tasks",
  "checklistItems",
  "workBlocks",
  "focusSessions",
  "focusPlan",
  "recurrenceRules",
  "templates",
  "thingsSync",
  "activity",
  "activityChanges",
  "calendars",
  "externalCommitments",
  "calendarSync",
  "workingHours",
  "healthDays",
  "ouraConnection",
  "estimateSuggestions",
  "secrets",
  "dayPlans",
  "features",
  "savedPlaces",
  "taskTrips",
  "stepSuggestions",
  "smartBlocks",
] as const;

export const seed = internalMutation({
  args: { today: v.optional(v.string()), timeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const table of SEEDED) for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(table, row._id);
    const today = parseIsoDate(args.today ?? "").unwrapOr(localIsoDate(new Date()));
    await seedPlanner(ctx, today, Date.now());
    await seedTimebox(ctx, today, args.timeZone ?? "Australia/Sydney");
    await seedSleep(ctx, today, args.timeZone ?? "Australia/Sydney");
    return null;
  },
});

export const seedBulk = internalMutation({
  args: {
    today: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    inbox: v.optional(v.number()),
    perDay: v.optional(v.number()),
    anytime: v.optional(v.number()),
    logbook: v.optional(v.number()),
  },
  handler: async (ctx, { inbox = 300, perDay = 12, anytime = 400, logbook = 1500, ...args }) => {
    const today = parseIsoDate(args.today ?? "").unwrapOr(localIsoDate(new Date()));
    const timeZone = args.timeZone ?? "Australia/Sydney";
    const areas = await ctx.db.query("areas").collect();
    const projects = await ctx.db.query("projects").collect();
    const labels = await ctx.db.query("labels").collect();
    const orders = generateNKeysBetween("b00", null, inbox + perDay * 14 + anytime + logbook);
    let made = 0;
    const base = (title: string) => {
      const label = labels[made % Math.max(1, labels.length)];
      const fields = {
        title,
        notes: made % 5 === 0 ? "A note with a link https://example.com and a few words to wrap onto another line." : "",
        labelIds: made % 4 === 0 && label ? [label._id] : [],
        order: orders[made] ?? "zz",
      };
      made += 1;
      return fields;
    };
    const parentOf = (index: number, everyNth: number) => {
      const project = projects[index % Math.max(1, projects.length)];
      const area = areas[index % Math.max(1, areas.length)];
      if (index % everyNth === 0 && project) return { kind: "project" as const, projectId: project._id };
      return area ? { kind: "area" as const, areaId: area._id } : { kind: "loose" as const };
    };
    for (let index = 0; index < inbox; index += 1)
      await ctx.db.insert("tasks", { ...base(`Bulk inbox thought ${index}`), when: { kind: "inbox" }, parent: { kind: "loose" }, status: { kind: "open" } });
    for (let day = -3; day < 11; day += 1)
      for (let index = 0; index < perDay; index += 1) {
        const taskId = await ctx.db.insert("tasks", {
          ...base(`Bulk day ${day} task ${index}`),
          when: { kind: "scheduled", date: addDays(today, day), evening: index % 6 === 5 },
          parent: parentOf(index + day + 30, 3),
          status: { kind: "open" },
          estimateMinutes: [15, 30, 45, 60, 90][index % 5],
          ...(index % 4 === 0 ? { deadline: addDays(today, day + 2) } : {}),
        });
        if (index < 5)
          await ctx.db.insert("workBlocks", {
            taskId,
            start: zonedMoment(addDays(today, day), (8 + index * 2) * 60 + 15, timeZone),
            minutes: [30, 45, 60, 90, 45][index] ?? 30,
            timeZone,
            done: false,
          });
      }
    for (let index = 0; index < anytime; index += 1)
      await ctx.db.insert("tasks", {
        ...base(`Bulk anytime ${index}`),
        when: { kind: index % 5 === 0 ? "someday" : "anytime" },
        parent: parentOf(index, 2),
        status: { kind: "open" },
      });
    const now = Date.now();
    for (let index = 0; index < logbook; index += 1)
      await ctx.db.insert("tasks", {
        ...base(`Bulk done ${index}`),
        when: { kind: "anytime" },
        parent: { kind: "loose" },
        status: { kind: "completed", at: now - index * 3_600_000 },
      });
    return made;
  },
});

export const rewindFocus = internalMutation({
  args: { minutes: v.number() },
  handler: async (ctx, { minutes }) => {
    const session = await activeSession(ctx);
    if (session) await ctx.db.patch("focusSessions", session._id, { start: session.start - minutes * 60_000 });
    return null;
  },
});

export const focusPlan = internalMutation({
  args: { mode: v.union(v.literal("open"), v.literal("pomodoro")) },
  handler: async (ctx, { mode }) => {
    for (const row of await ctx.db.query("focusPlan").collect()) await ctx.db.delete("focusPlan", row._id);
    await ctx.db.insert("focusPlan", { mode, focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 });
    return null;
  },
});

export const suggestEstimate = internalMutation({
  args: {
    title: v.string(),
    guesses: v.optional(v.array(v.object({ minutes: v.number(), probability: v.number() }))),
    reason: v.optional(v.string()),
    state: v.optional(v.union(v.literal("thinking"), v.literal("vague"))),
  },
  handler: async (ctx, { title, guesses = [], reason = "", state }) => {
    const task = (await ctx.db.query("tasks").collect()).find((row) => row.title === title);
    if (!task) throw new Error(`No Task called ${title}`);
    await ctx.db.patch("tasks", task._id, { estimateMinutes: undefined });
    const at = Date.now();
    const best = guesses.toSorted((a, b) => b.probability - a.probability)[0] ?? { minutes: 30, probability: 0 };
    const outcome =
      state === "thinking"
        ? { kind: "waiting" as const }
        : state === "vague"
          ? { kind: "unclear" as const, vague: 0.9, inputsHash: "seeded", at }
          : {
              kind: "suggested" as const,
              minutes: best.minutes,
              guesses: guesses.toSorted((a, b) => a.minutes - b.minutes),
              modelMinutes: best.minutes,
              reason,
              confidence: best.probability,
              probabilities: guesses,
              model: "gpt-6-luna",
              inputsHash: "seeded",
              at,
            };
    const fields = { requestedAt: at, outcome, ...(state === "thinking" ? {} : { answeredAt: at }) };
    const row = await ctx.db.query("estimateSuggestions").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    if (row) await ctx.db.replace("estimateSuggestions", row._id, { taskId: task._id, ...fields });
    else await ctx.db.insert("estimateSuggestions", { taskId: task._id, ...fields });
    return task._id;
  },
});

export const storeSecret = internalMutation({
  args: { last4: v.string(), name: v.optional(v.union(v.literal("openai"), v.literal("opencodeGo"))) },
  handler: async (ctx, { last4, name = "openai" }) => {
    for (const row of await ctx.db.query("secrets").collect()) if (row.name === name) await ctx.db.delete("secrets", row._id);
    await ctx.db.insert("secrets", { name, iv: "c2VlZGVk", ciphertext: "c2VlZGVk", last4, savedAt: Date.now() });
    return null;
  },
});

export const switchAi = internalMutation({
  args: { on: v.optional(v.boolean()) },
  handler: async (ctx, { on = true }) => {
    for (const row of await ctx.db.query("features").collect()) if (row.feature === "ai") await ctx.db.delete("features", row._id);
    await ctx.db.insert("features", { feature: "ai", enabled: on, settings: { routes: {} } });
    return null;
  },
});

export const suggestSteps = internalMutation({
  args: { title: v.string(), steps: v.array(v.string()), project: v.optional(v.boolean()) },
  handler: async (ctx, { title, steps, project = false }) => {
    const task = (await ctx.db.query("tasks").collect()).find((row) => row.title === title);
    if (!task) throw new Error(`No Task called ${title}`);
    const at = Date.now();
    const outcome = { kind: "suggested" as const, steps, project, answeredBy: "opencodeGo/deepseek-v4.1-flash", inputsHash: "seeded", at };
    const row = await ctx.db.query("stepSuggestions").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    if (row) await ctx.db.replace("stepSuggestions", row._id, { taskId: task._id, requestedAt: at, answeredAt: at, outcome });
    else await ctx.db.insert("stepSuggestions", { taskId: task._id, requestedAt: at, answeredAt: at, outcome });
    return task._id;
  },
});

const HOME = { lat: -33.8786, lon: 151.2036 };

const OFFICEWORKS = [
  { key: "node/1", name: "Officeworks", suburb: "Ultimo", position: { lat: -33.8813, lon: 151.1988 }, straightMetres: 540, travel: { seconds: 300, metres: 1900 } },
  { key: "node/2", name: "Officeworks", suburb: "Alexandria", position: { lat: -33.9105, lon: 151.1938 }, straightMetres: 3650, travel: { seconds: 720, metres: 4800 } },
  { key: "node/3", name: "Officeworks", suburb: "Bondi Junction", position: { lat: -33.8915, lon: 151.2489 }, straightMetres: 4400, travel: { seconds: 900, metres: 6100 } },
  { key: "node/4", name: "Officeworks", suburb: "Leichhardt", position: { lat: -33.8836, lon: 151.1566 }, straightMetres: 4400, travel: { seconds: 960, metres: 5900 } },
];

export const seedPlaces = internalMutation({
  args: { title: v.string(), home: v.optional(v.boolean()) },
  handler: async (ctx, { title, home = true }) => {
    for (const table of ["features", "savedPlaces", "taskTrips"] as const) for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(table, row._id);
    await ctx.db.insert("features", { feature: "places", enabled: true, settings: { travelMode: "drive" } });
    await ctx.db.insert("features", { feature: "ai", enabled: true, settings: { routes: {} } });
    if (home) await ctx.db.insert("savedPlaces", { label: "home", address: "12 Harbour Street, Haymarket NSW 2000", position: HOME, found: "12 Harbour Street, Haymarket", savedAt: Date.now() });
    const area = (await ctx.db.query("areas").collect())[0];
    const taskId = await ctx.db.insert("tasks", {
      title,
      notes: "",
      when: { kind: "scheduled", date: localIsoDate(new Date()), evening: false },
      parent: area ? { kind: "area", areaId: area._id } : { kind: "loose" },
      labelIds: [],
      status: { kind: "open" },
      order: "a0",
    });
    const at = Date.now();
    await ctx.db.insert("taskTrips", {
      taskId,
      requestedAt: at,
      outcome: { kind: "found", query: "officeworks", mode: "drive", from: { lat: -33.879, lon: 151.204 }, places: OFFICEWORKS, inputsHash: "seeded", at },
      choice: { kind: "nearest" },
    });
    return taskId;
  },
});

export const tripState = internalMutation({
  args: { title: v.string(), state: v.union(v.literal("looking"), v.literal("failed"), v.literal("found")) },
  handler: async (ctx, { title, state }) => {
    const task = (await ctx.db.query("tasks").collect()).find((row) => row.title === title);
    if (!task) throw new Error(`No Task called ${title}`);
    const row = await ctx.db.query("taskTrips").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    if (!row) throw new Error(`No Trip for ${title}`);
    const at = Date.now();
    const outcome =
      state === "looking"
        ? { kind: "waiting" as const, query: "officeworks" }
        : state === "failed"
          ? { kind: "failed" as const, error: { kind: "unavailable" as const }, query: "officeworks", inputsHash: "seeded", at }
          : { kind: "found" as const, query: "officeworks", mode: "drive" as const, from: { lat: -33.879, lon: 151.204 }, places: OFFICEWORKS, inputsHash: "seeded", at };
    await ctx.db.patch("taskTrips", row._id, { requestedAt: at, outcome, choice: { kind: "nearest" } });
    return null;
  },
});

export const stepsThinking = internalMutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const task = (await ctx.db.query("tasks").collect()).find((row) => row.title === title);
    if (!task) throw new Error(`No Task called ${title}`);
    const at = Date.now();
    const row = await ctx.db.query("stepSuggestions").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    if (row) await ctx.db.replace("stepSuggestions", row._id, { taskId: task._id, requestedAt: at, outcome: { kind: "waiting" } });
    else await ctx.db.insert("stepSuggestions", { taskId: task._id, requestedAt: at, outcome: { kind: "waiting" } });
    return task._id;
  },
});

export const signIn = internalMutation({
  args: {},
  handler: async (ctx) =>
    ctx.runMutation(components.auth.public._internal_dangerous_signUp, {
      claims: { method: "github", profile: { id: "1001", login: "avi", emailVerified: false } },
      componentPath: "authGithub",
      createUserHandle: await createFunctionHandle(internal.platform.access.createUser),
      onSignInHandle: await createFunctionHandle(internal.platform.access.onSignIn),
      accessTokenTtlSeconds: 3600,
      refreshInactivityTimeoutSeconds: 86400,
      sessionMaxLifetimeSeconds: 86400,
    }),
});
SCRATCH_TS

cd "$SCRATCH"
export CONVEX_AGENT_MODE=anonymous
npx convex dev --once --typecheck disable ${CONVEX_PORTS:-} >/dev/null 2>&1 || true
npx convex env set LIFEOS_OWNER_GITHUB_ID "$OWNER_ID" >/dev/null
npx convex env set SITE_URL "${BASE:-http://localhost:3990}" >/dev/null
npx convex env set AUTH_GITHUB_CLIENT_ID local >/dev/null
npx convex env set AUTH_GITHUB_CLIENT_SECRET local >/dev/null
npx convex env set OURA_CLIENT_ID local >/dev/null
npx convex env set OURA_CLIENT_SECRET local >/dev/null
npx convex env set LIFEOS_SECRETS_KEY "$(openssl rand -base64 32)" >/dev/null
npx convex dev --once --typecheck disable ${CONVEX_PORTS:-}
SEED_ARGS="{\"today\":\"$(date +%F)\",\"timeZone\":\"$(node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)')\"}"
npx convex run scratch:seed "$SEED_ARGS" >/dev/null
npx convex run scratch:signIn > "$SCRATCH/session.json"
echo "Local backend is seeded. Session: $SCRATCH/session.json"
echo "Reseed with: (cd $SCRATCH && npx convex run scratch:seed '$SEED_ARGS')"
echo "Add 2,400 Tasks for the perf scripts with: (cd $SCRATCH && npx convex run scratch:seedBulk '$SEED_ARGS')"
echo "Keep it running with: (cd $SCRATCH && CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable ${CONVEX_PORTS:-})"

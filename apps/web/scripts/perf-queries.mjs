import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const usage = `How long each list query takes when its answer is not cached, and how big the answer is.

Needs the throwaway backend from local-backend.sh, seeded (scratch:seedBulk adds 2,400 Tasks):

    SCRATCH=/tmp/lifeos-local-backend node scripts/perf-queries.mjs [output.json]

Convex caches a query until something it read changes, so each run first edits the notes of one
Task the query returned. CONVEX_URL and RUNS change the run.`;

const scratch = process.env.SCRATCH ?? process.exit(console.log(usage) ?? 1);
const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const runs = Number(process.env.RUNS ?? 7);
const signedIn = execFileSync("npx", ["convex", "run", "scratch:signIn"], {
  cwd: scratch,
  env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const client = new ConvexHttpClient(url);
client.setAuth(JSON.parse(signedIn).accessToken);

const today = new Date().toLocaleDateString("en-CA");
const dayStart = new Date(`${today}T00:00:00`).getTime();
const twoWeeks = { from: dayStart, to: dayStart + 14 * 86_400_000 };
const queries = [
  ["planner/sidebar:get", { date: today }],
  ["planner/today:get", { date: today }],
  ["planner/lists:inbox", {}],
  ["planner/lists:upcoming", { date: today, days: 28 }],
  ["planner/lists:anytime", { date: today }],
  ["planner/lists:someday", {}],
  ["planner/plan:week", { from: today, days: 14, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }],
  ["planner/workBlocks:range", twoWeeks],
  ["calendar/commitments:range", twoWeeks],
];

const taskIn = (value) => {
  if (value === null || typeof value !== "object") return null;
  if (!Array.isArray(value) && "checklist" in value && "labelIds" in value) return value;
  for (const inner of Object.values(value)) {
    const task = taskIn(inner);
    if (task) return task;
  }
  return null;
};

const ask = (name, args) => client.query(makeFunctionReference(name), args);
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const report = {};

for (const [name, args] of queries) {
  const times = [];
  let kb = 0;
  let cold = false;
  for (let run = 0; run < runs; run += 1) {
    const task = taskIn(await ask(name, args)) ?? (name === "planner/sidebar:get" ? taskIn(await ask("planner/lists:anytime", { date: today })) : null);
    if (task) {
      cold = true;
      await client.mutation(makeFunctionReference("planner/tasks:setNotes"), { taskId: task._id, notes: `perf ${run}` });
    }
    const start = performance.now();
    const answer = await ask(name, args);
    times.push(performance.now() - start);
    kb = Math.round(JSON.stringify(answer).length / 1024);
  }
  report[name] = { ms: Math.round(median(times)), kb, cold };
  console.log(name.padEnd(30), `${String(report[name].ms).padStart(5)} ms`, `${String(kb).padStart(6)} kB`, cold ? "" : "(cached: it returns no Task to edit)");
}

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));

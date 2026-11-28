import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE, PERF_OUT, readBaseline, type Result } from "../src/perf.ts";

const cell = (value: number | null | undefined) => (value === null || value === undefined ? "–" : String(value));

export default async () => {
  const folder = join(PERF_OUT, "results");
  if (!existsSync(folder)) return;
  const results = readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(folder, file), "utf8")) as Result)
    .toSorted((a, b) => a.key.localeCompare(b.key));
  const baseline = readBaseline();
  const header = "| engine | interaction | cold input→ready | input→ready | INP | blocking | long tasks | dropped | worst frame | commits | commit ms | baseline input→ready |";
  const rows = results.map(
    ({ key, engine, interaction, cold, warm }) =>
      `| ${engine} | ${interaction} | ${cell(cold?.inputToReady)} | ${cell(warm.inputToReady)} | ${cell(warm.inp)} | ${cell(warm.blockingMs)} | ${cell(warm.longTasks)} | ${cell(warm.dropped)} | ${cell(warm.worstFrame)} | ${cell(warm.commits)} | ${cell(warm.commitMs)} | ${cell(baseline[key]?.inputToReady)} |`,
  );
  const table = [header, `|${" --- |".repeat(12)}`, ...rows].join("\n");
  writeFileSync(join(PERF_OUT, "summary.json"), JSON.stringify(results, null, 2));
  writeFileSync(join(PERF_OUT, "summary.md"), `Medians in ms. Warm runs unless marked cold.\n\n${table}\n`);
  console.log(`\n${table}\n\nSummary: ${join(PERF_OUT, "summary.md")}`);
  if (process.env.E2E_PERF_UPDATE !== "1") return;
  const next = { ...baseline };
  for (const { key, warm } of results) next[key] = { inputToReady: warm.inputToReady, blockingMs: warm.blockingMs, dropped: warm.dropped, commitMs: warm.commitMs };
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline saved: ${BASELINE}`);
};

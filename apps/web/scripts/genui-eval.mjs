import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSpec } from "../../../packages/backend/shared/client/genui.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const home = join(root, "packages/backend/convex/ai/genui");
const { context, requests } = JSON.parse(readFileSync(join(home, "eval/requests.json"), "utf8"));
const [command, round = "round-1"] = process.argv.slice(2);
const TOOLS = ["start_focus", "stop_focus", "create_task", "set_task_status", "stop_run"];
const READS = ["list_tasks", "get_focus", "get_day_plan"];

const askOf = (request) => `${request.ask}\n\nReads: ${context.reads}\nTools: ${context.tools}\nSockets: ${request.socketWords ?? "none"}`;

if (command === "asks") {
  mkdirSync(join(home, "eval/asks"), { recursive: true });
  for (const request of requests) writeFileSync(join(home, "eval/asks", `${request.id}.txt`), `${askOf(request)}\n`);
  console.log(`${requests.length} asks written`);
}

const HARD_COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|font-family\s*:(?!\s*var\()/i;

const score = (request) => {
  const path = join(home, "eval", round, `${request.id}.ui`);
  if (!existsSync(path)) return { id: request.id, valid: false, layer: 0, right: false, issues: ["No output."], clean: false };
  const source = readFileSync(path, "utf8");
  const read = readSpec(source, { tools: TOOLS, reads: READS, sockets: request.sockets ?? [] });
  const layer = /<Frame[\s>]/.test(source) ? 3 : 2;
  const framed = source.match(/<Frame[\s\S]*<\/Frame>/)?.[0] ?? "";
  const clean = request.id === "palette-picker" || !HARD_COLOUR.test(framed);
  return { id: request.id, valid: read.isOk(), layer, right: request.layer.includes(layer), issues: read.isOk() ? [] : read.error, clean, chars: source.length };
};

if (command === "score") {
  const rows = requests.map(score);
  const count = (pick) => rows.filter(pick).length;
  console.log("| Request | Valid | Layer | Right layer | Own colours or fonts | Issues |\n| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) console.log(`| ${row.id} | ${row.valid ? "yes" : "no"} | ${row.layer} | ${row.right ? "yes" : "no"} | ${row.clean ? "none" : "yes"} | ${row.issues.join(" ")} |`);
  console.log(`\nvalid ${count((row) => row.valid)}/${rows.length}, right layer ${count((row) => row.right)}/${rows.length}, both ${count((row) => row.valid && row.right)}/${rows.length}, clean ${count((row) => row.clean)}/${rows.length}`);
  writeFileSync(join(home, "eval", round, "results.json"), `${JSON.stringify(rows, null, 2)}\n`);
}

if (command === "board") {
  const blocks = requests.flatMap((request) => {
    const path = join(home, "eval", round, `${request.id}.ui`);
    if (!existsSync(path)) return [];
    return [{ id: request.id, title: request.title, ask: request.ask.split("\n")[0], sockets: request.sockets ?? [], source: readFileSync(path, "utf8").replace(/^\s*```\w*\n|\n```\s*$/g, "").trim() }];
  });
  const out = join(root, "apps/web/src/components/design-board/genui/outputs.gen.ts");
  writeFileSync(out, `export const OUTPUTS: readonly { id: string; title: string; ask: string; sockets: readonly string[]; source: string }[] = ${JSON.stringify(blocks, null, 2)};\n`);
  console.log(`${blocks.length} blocks written to ${out}`);
}

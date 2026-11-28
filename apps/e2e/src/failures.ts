import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT } from "./stack.ts";

type Spec = { title: string; file: string; tests: { projectName: string; results: { status: string; error?: { message?: string } }[] }[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };

const file = process.argv[2] ?? join(OUT, "..", "results.json");
const report = JSON.parse(readFileSync(file, "utf8")) as Suite;
const colours = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (text: string) => text.replace(colours, "");
const specs: Spec[] = [];
const visit = (suite: Suite) => {
  specs.push(...(suite.specs ?? []));
  suite.suites?.forEach(visit);
};
visit(report);
for (const spec of specs)
  for (const test of spec.tests) {
    const last = test.results.at(-1);
    if (!last || last.status === "passed" || last.status === "skipped") continue;
    console.log(`\n## ${test.projectName} › ${spec.file} › ${spec.title} (${last.status})\n${strip(last.error?.message ?? "").split("\n").slice(0, Number(process.env.LINES ?? 14)).join("\n")}`);
  }

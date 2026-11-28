import { Result } from "effect";
import { expect, test } from "vitest";
import { CATALOGUE, checkSpec, frameMarkup, layerOf, parseSpec, readSpec } from "./genui";

const files = (found: Record<string, string>) => Object.entries(found).map(([path, source]) => ({ name: path.split("/").at(-1) ?? path, source }));

const EXAMPLES = files(import.meta.glob<string>("../../convex/ai/genui/examples/*.ui", { query: "?raw", import: "default", eager: true }));
const REPLIES = files(import.meta.glob<string>("../../convex/ai/genui/eval/round-2/*.ui", { query: "?raw", import: "default", eager: true }));
const PROMPT = Object.values(import.meta.glob<string>("../../convex/ai/genui/prompt.md", { query: "?raw", import: "default", eager: true }))[0] ?? "";
const CONTEXT = { tools: ["start_focus", "stop_focus", "create_task", "set_task_status", "stop_run"], reads: ["list_tasks", "get_focus", "get_day_plan"], sockets: ["frames"] };

test("every example in the prompt is a valid spec", () => {
  expect(EXAMPLES).toHaveLength(4);
  for (const example of EXAMPLES) expect(Result.isSuccess(readSpec(example.source, CONTEXT)), example.name).toBe(true);
});

test("the prompt names every tag in the catalogue and its examples are the example files", () => {
  for (const tag of Object.keys(CATALOGUE)) expect(PROMPT, tag).toContain(`<${tag}`);
  for (const example of EXAMPLES) expect(PROMPT, example.name).toContain(example.source.trim());
});

test("the replies Haiku wrote from the prompt alone are valid and pick the expected layer", () => {
  expect(REPLIES).toHaveLength(18);
  const framed = REPLIES.filter((reply) => Result.getOrThrow(readSpec(reply.source, CONTEXT)).layer === 3).map((reply) => reply.name);
  expect(framed.toSorted()).toEqual(["breathing.ui", "dice-roller.ui", "noughts-and-crosses.ui", "signature.ui", "spinning-logo.ui"]);
});

test("values may be bare, quoted or bound", () => {
  const [num] = parseSpec('<Num label="Best night" value={sleep.hours.max} unit=h ratio=16/9/>').nodes;
  expect(num?.attrs).toEqual({ label: "Best night", value: "{sleep.hours.max}", unit: "h", ratio: "16/9" });
});

test("a spec that is still arriving parses to what has arrived", () => {
  const whole = "<Row>\n<Num value=4 label=Days/>\n<Num value=620 unit=$/>\n</Row>\n<Text>Done</Text>";
  const early = parseSpec(whole.slice(0, 40));
  expect(early.complete).toBe(false);
  expect(early.nodes[0]?.children.map((child) => child.tag)).toEqual(["Num"]);
  expect(parseSpec(whole).complete).toBe(true);
});

test("the checker names what is wrong in words a model can act on", () => {
  const issues = checkSpec(parseSpec("<Gauge value=1/><Chart mark=pie data=sleep y=hours/><Button label=Go/><div>hi</div><Text>{nope.count}</Text>").nodes, CONTEXT);
  expect(issues).toEqual([
    "<Gauge> is not in the grammar.",
    "<Chart mark=pie> must be one of bar, line, area, point, spark.",
    "<Chart data=sleep> names no <Data> or socket.",
    "<Button> needs tool or set.",
    "<div> is plain HTML. It is only allowed inside <Frame>.",
    "{nope.count} names no data, socket or control.",
  ]);
});

test("a chart column and a tool must exist", () => {
  const issues = checkSpec(parseSpec("<Data name=s>\nday,hours\nMon,7\n</Data><Chart mark=bar data=s x=day y=minutes/><Button label=Go tool=delete_everything/>").nodes, CONTEXT);
  expect(issues).toEqual(["<Chart y=minutes> is not a column of s.", "<Button tool=delete_everything> is not a tool here."]);
});

test("a frame keeps its script as written and hands grammar tags to the renderer as slots", () => {
  const { nodes } = parseSpec('<Frame>\n<Row><Num value={n}/><button class=primary onclick="go()">Go</button></Row>\n<script>\nconst go = () => { if (1 < 2) ui.set("n", 1) }\n</script>\n</Frame>');
  expect(layerOf(nodes)).toBe(3);
  const frame = nodes[0];
  if (!frame) throw new Error("no frame");
  const { html, slots } = frameMarkup(frame);
  expect(slots.map((slot) => slot.tag)).toEqual(["Num"]);
  expect(html).toBe('<div class="gu-row"><gu-slot data-slot="0"></gu-slot><button class="primary" onclick="go()">Go</button></div><script>const go = () => { if (1 < 2) ui.set("n", 1) }</script>');
});

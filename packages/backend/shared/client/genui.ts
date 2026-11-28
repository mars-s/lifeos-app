import { err, ok } from "neverthrow";

type Kind = "text" | "number" | "name" | readonly string[];
type Body = "none" | "children" | "text" | "raw";
type Shape = { readonly attrs: Readonly<Record<string, Kind>>; readonly required: readonly string[]; readonly body: Body; readonly open?: true };

const TONES = ["muted", "faint", "good", "warn", "bad"] as const;

export const CATALOGUE = {
  Col: { attrs: { gap: ["tight", "loose"] }, required: [], body: "children" },
  Row: { attrs: { gap: ["tight", "loose"], align: ["start", "center", "end", "between"] }, required: [], body: "children" },
  Grid: { attrs: { cols: "number" }, required: [], body: "children" },
  Card: { attrs: { title: "text" }, required: [], body: "children" },
  Text: { attrs: { size: ["small", "body", "heading", "title"], tone: TONES }, required: [], body: "text" },
  Tag: { attrs: { tone: TONES }, required: [], body: "text" },
  Num: { attrs: { value: "text", label: "text", unit: "text", state: "text", tone: TONES, size: ["big", "small"] }, required: ["value"], body: "none" },
  Meter: { attrs: { value: "number", max: "number", kind: ["ring", "bar", "ticks", "dots"], label: "text", unit: "text" }, required: ["value"], body: "none" },
  Chart: { attrs: { mark: ["bar", "line", "area", "point", "spark"], data: "name", x: "name", y: "name", series: "name", h: "number" }, required: ["mark", "data", "y"], body: "none" },
  Table: { attrs: { data: "name", cols: "text", group: "name" }, required: ["data"], body: "none" },
  List: { attrs: { data: "name" }, required: ["data"], body: "children" },
  Item: { attrs: { title: "text", detail: "text", value: "text", tone: TONES }, required: ["title"], body: "none" },
  Image: { attrs: { src: "text", alt: "text", ratio: "text" }, required: ["src"], body: "none" },
  Media: { attrs: { src: "text", kind: ["video", "audio"] }, required: ["src"], body: "none" },
  Part: { attrs: { is: ["task", "note", "capacity", "day"], id: "text", date: "text" }, required: ["is"], body: "none" },
  Button: { attrs: { label: "text", tool: "name", set: "name", to: "text", tone: ["primary", "quiet", "danger"] }, required: ["label"], body: "none", open: true },
  Slider: { attrs: { bind: "name", min: "number", max: "number", step: "number", value: "number", label: "text", unit: "text" }, required: ["bind"], body: "none" },
  Pick: { attrs: { bind: "name", options: "text", value: "text", label: "text", kind: ["segment", "swatch", "menu"] }, required: ["bind", "options"], body: "none" },
  Toggle: { attrs: { bind: "name", label: "text", value: ["true", "false"] }, required: ["bind"], body: "none" },
  Input: { attrs: { bind: "name", label: "text", placeholder: "text", value: "text" }, required: ["bind"], body: "none" },
  Data: { attrs: { name: "name", from: "name" }, required: ["name"], body: "text", open: true },
  Frame: { attrs: { h: "number" }, required: [], body: "raw" },
} as const satisfies Record<string, Shape>;

export type UiTag = keyof typeof CATALOGUE;
export type UiNode = { tag: string; attrs: Record<string, string>; children: UiNode[]; text: string };
export type UiContext = { tools?: readonly string[]; reads?: readonly string[]; sockets?: readonly string[] };

const TEXT = "#text";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const VERBATIM = new Set(["Data", "script", "style", "textarea"]);
const NAME = /^[A-Za-z][\w-]*/;
const WORD = /^[A-Za-z_][\w.]*$/;
const BINDING = /\{([^{}]*)\}/g;
const AGGREGATES = new Set(["count", "sum", "avg", "min", "max", "first", "last"]);

const shapeOf = (tag: string) => (Object.hasOwn(CATALOGUE, tag) ? (CATALOGUE as Record<string, Shape>)[tag] : undefined);
const isRaw = (tag: string) => tag !== TEXT && tag[0] === tag[0]?.toLowerCase();
const node = (tag: string, attrs: Record<string, string> = {}, text = "") => ({ tag, attrs, children: [], text }) satisfies UiNode as UiNode;

const readValue = (source: string, at: number) => {
  const first = source[at];
  if (first === '"' || first === "'") {
    const end = source.indexOf(first, at + 1);
    return end < 0 ? undefined : { value: source.slice(at + 1, end), next: end + 1 };
  }
  if (first === "{") {
    const end = source.indexOf("}", at);
    return end < 0 ? undefined : { value: source.slice(at, end + 1), next: end + 1 };
  }
  const rest = source.slice(at);
  const stop = rest.search(/[\s>]|\/>/);
  return stop < 0 ? undefined : { value: rest.slice(0, stop), next: at + stop };
};

const readTag = (source: string, at: number) => {
  const name = NAME.exec(source.slice(at + 1))?.[0];
  if (!name) return undefined;
  const attrs: Record<string, string> = {};
  let cursor = at + 1 + name.length;
  while (cursor < source.length) {
    const gap = /^\s*/.exec(source.slice(cursor))?.[0].length ?? 0;
    cursor += gap;
    if (source.startsWith("/>", cursor)) return { name, attrs, closed: true, next: cursor + 2 };
    if (source[cursor] === ">") return { name, attrs, closed: false, next: cursor + 1 };
    const key = /^[^\s=/>]+/.exec(source.slice(cursor))?.[0];
    if (!key) {
      cursor += 1;
      continue;
    }
    cursor += key.length;
    if (source[cursor] !== "=") {
      attrs[key] = "";
      continue;
    }
    const read = readValue(source, cursor + 1);
    if (!read) return undefined;
    attrs[key] = read.value;
    cursor = read.next;
  }
  return undefined;
};

export const parseSpec = (source: string) => {
  const root = node("");
  const stack = [root];
  const top = () => stack.at(-1) ?? root;
  const say = (text: string) => {
    const parent = top();
    const kept = isRaw(parent.tag) && parent.tag !== "" ? text : text.trim();
    if (kept !== "") parent.children.push(node(TEXT, {}, kept));
  };
  let cursor = 0;
  let complete = true;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      say(source.slice(cursor));
      break;
    }
    say(source.slice(cursor, open));
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open);
      cursor = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[open + 1] === "/") {
      const end = source.indexOf(">", open);
      if (end < 0) {
        complete = false;
        break;
      }
      const name = source.slice(open + 2, end).trim();
      const depth = stack.findLastIndex((item) => item.tag === name);
      if (depth > 0) stack.length = depth;
      cursor = end + 1;
      continue;
    }
    if (!NAME.test(source.slice(open + 1))) {
      say("<");
      cursor = open + 1;
      continue;
    }
    const tag = readTag(source, open);
    if (!tag) {
      complete = false;
      break;
    }
    const made = node(tag.name, tag.attrs);
    top().children.push(made);
    cursor = tag.next;
    if (tag.closed || VOID.has(tag.name)) continue;
    if (!VERBATIM.has(tag.name)) {
      stack.push(made);
      continue;
    }
    const close = source.indexOf(`</${tag.name}>`, cursor);
    made.text = (close < 0 ? source.slice(cursor) : source.slice(cursor, close)).replace(/^\n|\s+$/g, "");
    if (close < 0) {
      complete = false;
      break;
    }
    cursor = close + tag.name.length + 3;
  }
  return { nodes: root.children, complete: complete && stack.length === 1 };
};

export const textOf: (item: UiNode) => string = (item) => (item.tag === TEXT ? item.text : item.children.map(textOf).join(""));

const walk = (nodes: readonly UiNode[], visit: (item: UiNode, inside: readonly UiNode[]) => void, inside: readonly UiNode[] = []) => {
  for (const item of nodes) {
    visit(item, inside);
    walk(item.children, visit, [...inside, item]);
  }
};

const hasFrame: (nodes: readonly UiNode[]) => boolean = (nodes) => nodes.some((item) => item.tag === "Frame" || hasFrame(item.children));

export const layerOf = (nodes: readonly UiNode[]) => (hasFrame(nodes) ? 3 : 2);

const csvHeader = (text: string) => (text.split("\n")[0] ?? "").split(",").map((cell) => cell.trim());

const fits = (kind: Kind, value: string) => {
  if (value.includes("{")) return true;
  if (kind === "number") return value !== "" && Number.isFinite(Number(value));
  if (kind === "name") return WORD.test(value);
  if (kind === "text") return true;
  return kind.includes(value);
};

const bindingsOf = (item: UiNode) => [...Object.values(item.attrs), item.tag === TEXT ? item.text : ""].flatMap((value) => [...value.matchAll(BINDING)].map((match) => (match[1] ?? "").trim()));

export const checkSpec = (nodes: readonly UiNode[], context: UiContext = {}) => {
  const issues: string[] = [];
  const data = new Map<string, readonly string[] | undefined>();
  const names = new Set(context.sockets);
  walk(nodes, (item) => {
    if (item.tag === "Data" && item.attrs.name) data.set(item.attrs.name, item.attrs.from === undefined ? csvHeader(item.text) : undefined);
    if (item.attrs.bind) names.add(item.attrs.bind);
    if (item.attrs.set) names.add(item.attrs.set);
  });
  const known = (name: string) => data.has(name) || names.has(name);

  if (nodes.length === 0) issues.push("The spec is empty.");
  walk(nodes, (item, inside) => {
    const framed = inside.some((parent) => parent.tag === "Frame");
    const rows = inside.some((parent) => parent.tag === "List");
    if (item.tag === TEXT) {
      if (!framed) for (const path of bindingsOf(item)) if (!rows && !known(path.split(".")[0] ?? "")) issues.push(`{${path}} names no data, socket or control.`);
      return;
    }
    if (isRaw(item.tag)) {
      if (!framed) issues.push(`<${item.tag}> is plain HTML. It is only allowed inside <Frame>.`);
      return;
    }
    const shape = shapeOf(item.tag);
    if (!shape) {
      issues.push(`<${item.tag}> is not in the grammar.`);
      return;
    }
    if (item.tag === "Frame" && framed) issues.push("A <Frame> cannot sit inside another <Frame>.");
    if (item.tag === "List" && item.children.some((child) => isRaw(child.tag))) issues.push("<List> repeats grammar tags only.");
    for (const key of shape.required) if (item.attrs[key] === undefined) issues.push(`<${item.tag}> needs ${key}.`);
    for (const [key, value] of Object.entries(item.attrs)) {
      const kind = shape.attrs[key];
      if (kind === undefined) {
        if (!shape.open) issues.push(`<${item.tag}> has no ${key}.`);
        continue;
      }
      if (!fits(kind, value)) issues.push(`<${item.tag} ${key}=${value}> must be ${typeof kind === "string" ? `a ${kind}` : `one of ${kind.join(", ")}`}.`);
    }
    if (shape.body === "none" && item.children.length > 0) issues.push(`<${item.tag}> takes no children.`);
    if (shape.body === "text" && item.children.some((child) => child.tag !== TEXT)) issues.push(`<${item.tag}> takes text only.`);
    if (item.tag === "Button") {
      if (item.attrs.tool === undefined && item.attrs.set === undefined) issues.push("<Button> needs tool or set.");
      if (item.attrs.tool !== undefined && context.tools && !context.tools.includes(item.attrs.tool)) issues.push(`<Button tool=${item.attrs.tool}> is not a tool here.`);
    }
    if (item.tag === "Data") {
      if (item.attrs.from !== undefined && context.reads && !context.reads.includes(item.attrs.from)) issues.push(`<Data from=${item.attrs.from}> is not a read tool here.`);
      if (item.attrs.from === undefined && item.text.trim() === "") issues.push(`<Data name=${item.attrs.name ?? ""}> has no rows and no from.`);
    }
    const source = shape.attrs.data === undefined ? undefined : item.attrs.data;
    if (source !== undefined && !known(source)) issues.push(`<${item.tag} data=${source}> names no <Data> or socket.`);
    const header = source === undefined ? undefined : data.get(source);
    if (item.tag === "Chart" && header) {
      for (const key of ["x", "y", "series"] as const) {
        const field = item.attrs[key];
        if (field !== undefined && field !== "count" && !header.includes(field)) issues.push(`<Chart ${key}=${field}> is not a column of ${source}.`);
      }
    }
    if (framed) return;
    for (const path of bindingsOf(item)) {
      const [head = "", ...rest] = path.split(".");
      if (rows && !known(head)) continue;
      if (!known(head)) issues.push(`{${path}} names no data, socket or control.`);
      const fields = data.get(head);
      const [field, fold] = rest;
      if (fields && field !== undefined && !fields.includes(field) && !AGGREGATES.has(field)) issues.push(`{${path}}: ${head} has no column ${field}.`);
      if (fold !== undefined && !AGGREGATES.has(fold)) issues.push(`{${path}}: ${fold} is not one of ${[...AGGREGATES].join(", ")}.`);
    }
  });
  return issues;
};

export const readSpec = (source: string, context: UiContext = {}) => {
  const parsed = parseSpec(source.replace(/^\s*```\w*\n|\n```\s*$/g, ""));
  const issues = [...(parsed.complete ? [] : ["The spec stops before its last tag closes."]), ...checkSpec(parsed.nodes, context)];
  return issues.length > 0 ? err(issues) : ok({ nodes: parsed.nodes, layer: layerOf(parsed.nodes) });
};

const escapeAttr = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const CONTAINER = {
  Col: (attrs: Record<string, string>) => `class="gu-col${attrs.gap ? ` gu-gap-${attrs.gap}` : ""}"`,
  Row: (attrs: Record<string, string>) => `class="gu-row${attrs.gap ? ` gu-gap-${attrs.gap}` : ""}${attrs.align ? ` gu-align-${attrs.align}` : ""}"`,
  Grid: (attrs: Record<string, string>) => `class="gu-grid" style="--cols:${Number(attrs.cols) || 2}"`,
  Card: () => 'class="gu-card"',
} as const;

const isContainer = (tag: string): tag is keyof typeof CONTAINER => Object.hasOwn(CONTAINER, tag);

export const frameMarkup = (frame: UiNode) => {
  const slots: UiNode[] = [];
  const write: (item: UiNode) => string = (item) => {
    if (item.tag === TEXT) return item.text;
    if (isContainer(item.tag)) {
      const inner = item.children.map(write).join("");
      const title = item.tag === "Card" && item.attrs.title !== undefined ? `<p class="gu-card-title">${escapeAttr(item.attrs.title)}</p>` : "";
      return `<div ${CONTAINER[item.tag](item.attrs)}>${title}${item.tag === "Card" ? `<div class="gu-card-body">${inner}</div>` : inner}</div>`;
    }
    if (!isRaw(item.tag)) {
      slots.push(item);
      return `<gu-slot data-slot="${slots.length - 1}"></gu-slot>`;
    }
    const attrs = Object.entries(item.attrs)
      .map(([key, value]) => (value === "" ? ` ${key}` : ` ${key}="${escapeAttr(value)}"`))
      .join("");
    if (VOID.has(item.tag)) return `<${item.tag}${attrs}>`;
    return `<${item.tag}${attrs}>${VERBATIM.has(item.tag) ? item.text : item.children.map(write).join("")}</${item.tag}>`;
  };
  return { html: frame.children.map(write).join(""), slots };
};

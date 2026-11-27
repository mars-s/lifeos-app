import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, RangeSetBuilder, StateEffect, StateField, Facet } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { ySyncAnnotation } from "y-codemirror.next";
import { entityLinkPattern, labelPattern, noteLinkPattern, type EntityTable } from "@lifeos/notes/markdown";

export type ChipInfo = {
  id: string;
  table: EntityTable;
  title: string;
  done?: boolean;
  progress?: number;
  colour?: string | undefined;
  trashed?: boolean;
};

export type EditorHost = {
  openNote: (title: string) => void;
  openEntity: (table: EntityTable, id: string) => void;
  toggleTask: (id: string, done: boolean) => void;
  noteExists: (title: string) => boolean;
};

export const hostFacet = Facet.define<EditorHost, EditorHost | null>({ combine: (hosts) => hosts.at(-1) ?? null });

export const titledFacet = Facet.define<boolean, boolean>({ combine: (values) => values.at(-1) ?? true });

export const setChips = StateEffect.define<ReadonlyMap<string, ChipInfo>>();
export const notesChanged = StateEffect.define<number>();

export const chipField = StateField.define<ReadonlyMap<string, ChipInfo>>({
  create: () => new Map(),
  update: (value, tr) => tr.effects.reduce((current, effect) => (effect.is(setChips) ? effect.value : current), value),
});

const hostOf = (view: EditorView) => view.state.facet(hostFacet);

class MarginMark extends WidgetType {
  constructor(
    readonly text: string,
    readonly shown: boolean,
  ) {
    super();
  }
  override eq(other: MarginMark) {
    return other.text === this.text && other.shown === this.shown;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-margin-mark${this.shown ? " is-shown" : ""}`;
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

class Bullet extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

class TodoBox extends WidgetType {
  constructor(
    readonly done: boolean,
    readonly at: number,
  ) {
    super();
  }
  override eq(other: TodoBox) {
    return other.done === this.done && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("button");
    box.type = "button";
    box.className = `cm-todo${this.done ? " is-done" : ""}`;
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.done));
    box.setAttribute("aria-label", "To-do");
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.done ? " " : "x" } });
    });
    return box;
  }
  override ignoreEvent() {
    return true;
  }
}

class Rule extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-rule";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

const KIND_OF = { tasks: "task", projects: "project", areas: "area" } as const;

class Chip extends WidgetType {
  constructor(
    readonly table: EntityTable,
    readonly id: string,
    readonly alias: string,
    readonly info: ChipInfo | undefined,
  ) {
    super();
  }
  override eq(other: Chip) {
    return (
      other.id === this.id &&
      other.alias === this.alias &&
      other.info?.title === this.info?.title &&
      other.info?.done === this.info?.done &&
      other.info?.progress === this.info?.progress &&
      other.info?.colour === this.info?.colour &&
      other.info?.trashed === this.info?.trashed
    );
  }
  toDOM(view: EditorView) {
    const title = this.info?.title ?? (this.alias || "Missing");
    const chip = document.createElement("span");
    chip.className = `cm-chip cm-chip-${KIND_OF[this.table]}${this.info?.trashed ? " is-trashed" : ""}${this.info ? "" : " is-unknown"}`;
    chip.dataset.entity = `${this.table}:${this.id}`;
    if (this.table === "tasks") {
      const done = this.info?.done ?? false;
      const box = document.createElement("button");
      box.type = "button";
      box.className = `cm-chip-box${done ? " is-done" : ""}`;
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", String(done));
      box.setAttribute("aria-label", title);
      box.addEventListener("mousedown", (event) => event.preventDefault());
      box.addEventListener("click", () => hostOf(view)?.toggleTask(this.id, !done));
      chip.append(box);
    } else {
      const dot = document.createElement("span");
      dot.className = this.table === "projects" ? "cm-chip-pie" : "cm-chip-dot";
      dot.setAttribute("aria-hidden", "true");
      if (this.info?.colour) dot.style.setProperty("--chip-colour", `var(--area-${this.info.colour})`);
      if (this.table === "projects") dot.style.setProperty("--chip-progress", `${Math.round((this.info?.progress ?? 0) * 360)}deg`);
      chip.append(dot);
    }
    const label = document.createElement("button");
    label.type = "button";
    label.className = `cm-chip-label${this.info?.done ? " is-done" : ""}`;
    label.textContent = title;
    label.addEventListener("mousedown", (event) => event.preventDefault());
    label.addEventListener("click", () => hostOf(view)?.openEntity(this.table, this.id));
    chip.append(label);
    return chip;
  }
  override ignoreEvent() {
    return true;
  }
}

class WikiLink extends WidgetType {
  constructor(
    readonly title: string,
    readonly shown: string,
    readonly exists: boolean,
  ) {
    super();
  }
  override eq(other: WikiLink) {
    return other.title === this.title && other.shown === this.shown && other.exists === this.exists;
  }
  toDOM(view: EditorView) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = `cm-wikilink${this.exists ? "" : " is-missing"}`;
    link.textContent = this.shown;
    link.title = this.exists ? `Open ${this.title}` : `${this.title} is not written yet. Open it to start it`;
    link.addEventListener("mousedown", (event) => event.preventDefault());
    link.addEventListener("click", () => hostOf(view)?.openNote(this.title));
    return link;
  }
  override ignoreEvent() {
    return true;
  }
}

const activeLines = (state: EditorState) => {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
};

const hide = Decoration.replace({});
const inlineMark = Decoration.mark({ class: "cm-inline-mark" });
const lineClass = (cls: string) => Decoration.line({ class: cls });

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: "cm-h1",
  ATXHeading2: "cm-h2",
  ATXHeading3: "cm-h3",
  ATXHeading4: "cm-h3",
  ATXHeading5: "cm-h3",
  ATXHeading6: "cm-h3",
};

const STYLE_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-strong",
  Emphasis: "cm-em",
  Strikethrough: "cm-strike",
  InlineCode: "cm-code",
  Link: "cm-link",
};

const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark", "URL"]);

const build = (view: EditorView) => {
  const { state } = view;
  const active = activeLines(state);
  const chips = state.field(chipField);
  const host = hostOf(view);
  const ranges: Range<Decoration>[] = [];
  const lineDecos = new Map<number, Set<string>>();
  const addLine = (pos: number, cls: string) => {
    const line = state.doc.lineAt(pos);
    const set = lineDecos.get(line.from) ?? new Set<string>();
    set.add(cls);
    lineDecos.set(line.from, set);
  };
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const taken: [number, number][] = [];
  const overlaps = (from: number, to: number) => taken.some(([a, b]) => from < b && to > a);

  const firstLine = state.doc.line(1);
  const titled = state.facet(titledFacet);
  if (titled && (firstLine.length > 0 || state.doc.lines > 1)) addLine(firstLine.from, "cm-note-title");
  for (const number of active) addLine(state.doc.line(number).from, "cm-active");

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (HEADING_CLASS[name]) addLine(node.from, HEADING_CLASS[name]);
        if (STYLE_CLASS[name]) ranges.push(Decoration.mark({ class: STYLE_CLASS[name] }).range(node.from, node.to));
        if (name === "FencedCode") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            addLine(line.from, "cm-codeblock");
            pos = line.to + 1;
          }
          return false;
        }
        if (name === "Blockquote") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            addLine(line.from, "cm-quote");
            pos = line.to + 1;
          }
        }
        if (name === "HeaderMark" || name === "QuoteMark") {
          const end = Math.min(state.doc.lineAt(node.from).to, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
          if (titled && name === "HeaderMark" && state.doc.lineAt(node.from).number === 1) {
            if (!isActive(node.from)) ranges.push(hide.range(node.from, end));
            else ranges.push(inlineMark.range(node.from, end));
            return;
          }
          ranges.push(Decoration.replace({ widget: new MarginMark(state.sliceDoc(node.from, node.to), isActive(node.from)) }).range(node.from, end));
          taken.push([node.from, end]);
          return;
        }
        if (name === "HorizontalRule" && !isActive(node.from)) {
          ranges.push(Decoration.replace({ widget: new Rule() }).range(node.from, node.to));
          return;
        }
        if (name === "ListMark") {
          const after = state.sliceDoc(node.to, node.to + 4);
          const isTask = /^ \[[ xX]\]/.test(after);
          const ordered = /\d/.test(state.sliceDoc(node.from, node.to));
          if (isTask) {
            const done = after[2] !== " ";
            ranges.push(Decoration.replace({ widget: new TodoBox(done, node.to + 1) }).range(node.from, node.to + 4));
            if (done) addLine(node.from, "cm-todo-done");
            taken.push([node.from, node.to + 4]);
          } else if (!ordered && !isActive(node.from)) {
            ranges.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
          } else if (!ordered) {
            ranges.push(inlineMark.range(node.from, node.to));
          }
          return;
        }
        if (name === "TaskMarker") return;
        if (INLINE_MARKS.has(name)) {
          if (overlaps(node.from, node.to)) return;
          ranges.push((isActive(node.from) ? inlineMark : hide).range(node.from, node.to));
        }
      },
    });

    const text = state.sliceDoc(from, to);
    for (const match of text.matchAll(entityLinkPattern)) {
      const start = from + (match.index ?? 0);
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      const table = ({ task: "tasks", project: "projects", area: "areas" } as const)[match[1] as "task" | "project" | "area"];
      const id = match[2] ?? "";
      ranges.push(Decoration.replace({ widget: new Chip(table, id, match[3] ?? "", chips.get(id)) }).range(start, end));
      taken.push([start, end]);
    }
    for (const match of text.matchAll(noteLinkPattern)) {
      const start = from + (match.index ?? 0);
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      const title = (match[1] ?? "").trim();
      const exists = host?.noteExists(title) ?? false;
      if (isActive(start)) {
        ranges.push(inlineMark.range(start, start + 2), inlineMark.range(end - 2, end));
        ranges.push(Decoration.mark({ class: `cm-wikilink-raw${exists ? "" : " is-missing"}` }).range(start + 2, end - 2));
      } else {
        ranges.push(Decoration.replace({ widget: new WikiLink(title, (match[2] ?? title).trim(), exists) }).range(start, end));
      }
      taken.push([start, end]);
    }
    for (const match of text.matchAll(labelPattern)) {
      const start = from + (match.index ?? 0) + (match[1]?.length ?? 0);
      const end = start + 1 + (match[2]?.length ?? 0);
      if (overlaps(start, end)) continue;
      ranges.push(Decoration.mark({ class: "cm-tag" }).range(start, end));
    }
  }

  for (const [from, classes] of lineDecos) ranges.push(lineClass([...classes].join(" ")).range(from));
  return Decoration.set(ranges, true);
};

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(setChips) || e.is(notesChanged)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || refreshed) this.decorations = build(update.view);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

const clearMerge = StateEffect.define<null>();
const MERGE_MS = 1800;

const mergeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    if (tr.effects.some((e) => e.is(clearMerge))) return Decoration.none;
    let next = value.map(tr.changes);
    if (tr.annotation(ySyncAnnotation) !== undefined && tr.docChanged) {
      const builder = new RangeSetBuilder<Decoration>();
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) builder.add(fromB, toB, Decoration.mark({ class: "cm-merged" }));
      });
      next = next.update({ add: [...iterate(builder.finish())] });
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function* iterate(set: DecorationSet) {
  const cursor = set.iter();
  while (cursor.value) {
    yield cursor.value.range(cursor.from, cursor.to);
    cursor.next();
  }
}

const mergeTimer = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    update(update: ViewUpdate) {
      if (!update.transactions.some((tr) => tr.annotation(ySyncAnnotation) !== undefined && tr.docChanged)) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => update.view.dispatch({ effects: clearMerge.of(null) }), MERGE_MS);
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

export const notePreview = () => [chipField, previewPlugin, mergeField, mergeTimer] satisfies Extension;

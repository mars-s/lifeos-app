import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { KatexOptions } from "katex";
import { findMath, type MathSpan } from "@lifeos/notes/math";

type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

const addStyle = (css: string) => {
  const style = document.createElement("style");
  style.dataset.katex = "";
  style.textContent = css;
  document.head.append(style);
};

const loadKatex = () =>
  (loading ??= Promise.all([import("katex"), import("./katex-style.gen")]).then(([module, { katexStyle }]) => {
    addStyle(katexStyle);
    katex = module.default;
    return katex;
  }));

const OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "ignore",
  maxExpand: 300,
  maxSize: 20,
  errorColor: "var(--math-error)",
} satisfies KatexOptions;

const draw = (into: HTMLElement, tex: string, display: boolean, ready: Katex) => {
  into.textContent = "";
  try {
    ready.render(tex, into, { ...OPTIONS, displayMode: display });
  } catch (error) {
    into.textContent = tex;
    into.classList.add("is-error");
    into.title = error instanceof Error ? error.message : String(error);
  }
};

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly block: boolean,
    readonly preview: boolean,
  ) {
    super();
  }
  override eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display && other.block === this.block && other.preview === this.preview;
  }
  toDOM(view: EditorView) {
    const element = document.createElement(this.block ? "div" : "span");
    element.className = ["cm-math", this.display && "cm-math-display", this.block && "cm-math-block", this.preview && "is-preview"].filter(Boolean).join(" ");
    if (katex) draw(element, this.tex, this.display, katex);
    else {
      element.textContent = this.tex;
      element.classList.add("is-loading");
      void loadKatex().then(
        (ready) => {
          element.classList.remove("is-loading");
          draw(element, this.tex, this.display, ready);
          view.requestMeasure();
        },
        () => element.classList.replace("is-loading", "is-error"),
      );
    }
    if (!this.preview) {
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const at = view.posAtDOM(element);
        const inside = this.display ? 2 + (this.tex.startsWith("\n") ? 1 : 0) : 1;
        view.dispatch({ selection: { anchor: at + inside } });
        view.focus();
      });
    }
    return element;
  }
  override get estimatedHeight() {
    return this.block ? 72 : -1;
  }
  override ignoreEvent() {
    return true;
  }
}

const touches = (state: EditorState, span: MathSpan) => state.selection.ranges.some((range) => range.from <= span.to && range.to >= span.from);

const fillsLines = (state: EditorState, span: MathSpan) => state.doc.lineAt(span.from).from === span.from && state.doc.lineAt(span.to).to === span.to;

const delimiter = Decoration.mark({ class: "cm-inline-mark" });
const source = Decoration.mark({ class: "cm-math-source" });

const decorate = (state: EditorState, spans: readonly MathSpan[]) => {
  const ranges: Range<Decoration>[] = [];
  for (const span of spans) {
    const block = span.display && fillsLines(state, span);
    if (!touches(state, span)) {
      ranges.push(Decoration.replace({ widget: new MathWidget(span.tex, span.display, block, false), block }).range(span.from, span.to));
      continue;
    }
    const edge = span.display ? 2 : 1;
    ranges.push(delimiter.range(span.from, span.from + edge), source.range(span.from + edge, span.to - edge), delimiter.range(span.to - edge, span.to));
    if (block) ranges.push(Decoration.widget({ widget: new MathWidget(span.tex, true, true, true), block: true, side: 1 }).range(span.to));
  }
  return Decoration.set(ranges, true);
};

type MathState = { readonly spans: readonly MathSpan[]; readonly decorations: DecorationSet };

const mathState = (state: EditorState, spans: readonly MathSpan[]) => ({ spans, decorations: spans.length === 0 ? Decoration.none : decorate(state, spans) }) satisfies MathState;

export const mathField = StateField.define<MathState>({
  create: (state) => mathState(state, findMath(state.doc.toString())),
  update: (value, tr) => {
    if (!tr.docChanged && !tr.selection) return value;
    const spans = tr.docChanged ? findMath(tr.state.doc.toString()) : value.spans;
    if (spans.length === 0 && value.spans.length === 0) return value;
    return mathState(tr.state, spans);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

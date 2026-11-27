import { Annotation, type Range } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { Awareness, PresenceChange } from "@lifeos/notes/presence";
import * as Y from "yjs";

export const NAME_SHOWS_MS = 1600;
const peersChanged = Annotation.define<null>();

type PeerCursor = { anchor?: unknown; head?: unknown };
type PeerState = { user?: { name?: unknown }; cursor?: PeerCursor | null };

class PeerCaret extends WidgetType {
  constructor(
    readonly name: string,
    readonly active: boolean,
  ) {
    super();
  }

  override eq(other: PeerCaret) {
    return other.name === this.name && other.active === this.active;
  }

  toDOM() {
    const caret = document.createElement("span");
    caret.className = "cm-peer";
    caret.setAttribute("aria-hidden", "true");
    caret.dataset.active = String(this.active);
    const name = document.createElement("span");
    name.className = "cm-peer-name";
    name.textContent = this.name;
    caret.append(name);
    return caret;
  }

  override updateDOM(dom: HTMLElement) {
    dom.dataset.active = String(this.active);
    const name = dom.firstElementChild;
    if (name) name.textContent = this.name;
    return true;
  }

  override ignoreEvent() {
    return true;
  }
}

const peerSelection = Decoration.mark({ class: "cm-peer-selection" });

const positionOf = (json: unknown, ytext: Y.Text) => {
  if (json === null || typeof json !== "object") return null;
  const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), ytext.doc!);
  return absolute && absolute.type === ytext ? absolute.index : null;
};

const sameSpot = (json: unknown, next: Y.RelativePosition) =>
  json !== null && typeof json === "object" && Y.compareRelativePositions(Y.createRelativePositionFromJSON(json), next);

const nameOf = (state: PeerState) => (typeof state.user?.name === "string" ? state.user.name.slice(0, 24) : "Another device");

export const peerCursors = (ytext: Y.Text, awareness: Awareness) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private readonly moved = new Map<number, number>();
      private fade: ReturnType<typeof setTimeout> | null = null;

      constructor(private readonly view: EditorView) {
        awareness.on("change", this.onChange);
        this.decorations = this.build();
      }

      private readonly onChange = ({ added, updated, removed }: PresenceChange) => {
        const now = Date.now();
        let touched = false;
        for (const clientID of [...added, ...updated]) {
          if (clientID === awareness.clientID) continue;
          this.moved.set(clientID, now);
          touched = true;
        }
        for (const clientID of removed) {
          this.moved.delete(clientID);
          touched = true;
        }
        if (touched) this.view.dispatch({ annotations: peersChanged.of(null) });
      };

      update(update: ViewUpdate) {
        this.publish(update);
        const changed = update.transactions.some((tr) => tr.annotation(peersChanged) !== undefined);
        if (changed || update.docChanged) this.decorations = this.build();
      }

      private publish(update: ViewUpdate) {
        const local = awareness.getLocalState() as PeerState | null;
        if (!local || !update.view.hasFocus) return;
        if (!update.selectionSet && !update.focusChanged && !update.docChanged) return;
        const selection = update.state.selection.main;
        const anchor = Y.createRelativePositionFromTypeIndex(ytext, selection.anchor);
        const head = Y.createRelativePositionFromTypeIndex(ytext, selection.head);
        if (local.cursor && sameSpot(local.cursor.anchor, anchor) && sameSpot(local.cursor.head, head)) return;
        awareness.setLocalStateField("cursor", { anchor: Y.relativePositionToJSON(anchor), head: Y.relativePositionToJSON(head) });
      }

      private build() {
        const now = Date.now();
        const length = this.view.state.doc.length;
        const ranges: Range<Decoration>[] = [];
        let nextFade = Infinity;
        for (const [clientID, raw] of awareness.getStates()) {
          if (clientID === awareness.clientID) continue;
          const state = raw as PeerState;
          const anchor = positionOf(state.cursor?.anchor, ytext);
          const head = positionOf(state.cursor?.head, ytext);
          if (anchor === null || head === null) continue;
          const from = Math.min(anchor, head, length);
          const to = Math.min(Math.max(anchor, head), length);
          if (from < to) ranges.push(peerSelection.range(from, to));
          const fadesAt = (this.moved.get(clientID) ?? 0) + NAME_SHOWS_MS;
          if (fadesAt > now) nextFade = Math.min(nextFade, fadesAt);
          const caret = new PeerCaret(nameOf(state), fadesAt > now);
          ranges.push(Decoration.widget({ widget: caret, side: head > anchor ? -1 : 1 }).range(Math.min(head, length)));
        }
        this.later(nextFade - now);
        return Decoration.set(ranges, true);
      }

      private later(wait: number) {
        if (this.fade) clearTimeout(this.fade);
        this.fade = null;
        if (!Number.isFinite(wait)) return;
        this.fade = setTimeout(() => {
          this.fade = null;
          this.view.dispatch({ annotations: peersChanged.of(null) });
        }, wait + 20);
      }

      destroy() {
        awareness.off("change", this.onChange);
        if (this.fade) clearTimeout(this.fade);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );

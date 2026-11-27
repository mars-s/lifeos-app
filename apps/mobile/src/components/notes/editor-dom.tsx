"use dom";

import { startCompletion } from "@codemirror/autocomplete";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { useDOMImperativeHandle } from "expo/dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import * as Y from "yjs";
import { NoteEditor, type ChipInfo, type NoteEditorHost } from "@lifeos/notes/editor";
import { titleKey } from "@lifeos/notes/markdown";
import { fromBase64, toBase64 } from "@/lib/notes/base64";
import type { EditorBridge, EditorHandle } from "@/lib/notes/bridge";

const nativeOrigin = Symbol("native");
const SEND_EVERY_MS = 16;

type Props = EditorBridge & { ref: Ref<EditorHandle>; dom?: import("expo/dom").DOMProps };

const viewOf = () => {
  const content = document.querySelector<HTMLElement>(".cm-content");
  return content ? EditorView.findFromDOM(content) : null;
};

const toggleLinePrefix = (view: EditorView, pattern: RegExp, prefix: string) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const found = pattern.exec(line.text);
  view.dispatch(
    found
      ? { changes: { from: line.from, to: line.from + found[0].length, insert: "" } }
      : { changes: { from: line.from, insert: prefix } },
  );
  view.focus();
};

export default function EditorDom(props: Props) {
  const { ref: handleRef, initial, incoming, events, chips, titles, titled, placeholder, label, theme, top, bottom, autoFocus } = props;
  const [doc] = useState(() => {
    const created = new Y.Doc();
    Y.applyUpdate(created, fromBase64(initial), nativeOrigin);
    return created;
  });
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let queued: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (queued.length === 0) return;
      const merged = queued.length === 1 ? queued[0]! : Y.mergeUpdates(queued);
      queued = [];
      void latest.current.onUpdate(toBase64(merged));
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === nativeOrigin) return;
      queued.push(update);
      timer ??= setTimeout(flush, SEND_EVERY_MS);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
      flush();
    };
  }, [doc]);

  const seen = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.seq <= seen.current) return;
    seen.current = incoming.seq;
    Y.applyUpdate(doc, fromBase64(incoming.update), nativeOrigin);
    void latest.current.onAck(incoming.seq);
  }, [incoming, doc]);

  const tickets = useRef(new Map<number, { saved: (taskId: string) => void; undone: () => void }>());
  const lastEvent = useRef(0);
  useEffect(() => {
    for (const event of events) {
      if (event.id <= lastEvent.current) continue;
      lastEvent.current = event.id;
      const waiting = tickets.current.get(event.ticket);
      if (!waiting) continue;
      if (event.kind === "saved" && event.taskId) waiting.saved(event.taskId);
      if (event.kind === "undone") {
        waiting.undone();
        tickets.current.delete(event.ticket);
      }
    }
  }, [events]);

  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  useEffect(() => {
    void latest.current.onFocusChange(focused);
  }, [focused]);

  useDOMImperativeHandle(
    handleRef,
    () => ({
      todo: () => {
        const view = viewOf();
        if (view) toggleLinePrefix(view, /^(\s*)[-*+] \[[ xX]\] /, "- [ ] ");
      },
      heading: () => {
        const view = viewOf();
        if (view) toggleLinePrefix(view, /^#{1,3} /, "## ");
      },
      link: () => {
        const view = viewOf();
        if (!view) return;
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: "[[" }, selection: { anchor: at + 2 } });
        view.focus();
        startCompletion(view);
      },
      makeTask: () => {
        const view = viewOf();
        if (!view) return;
        runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Enter", metaKey: true }), "editor");
      },
      blur: () => {
        (document.activeElement as HTMLElement | null)?.blur();
      },
    }),
    [],
  );

  const chipMap = useMemo(() => new Map<string, ChipInfo>(chips.map((chip) => [chip.id, chip])), [chips]);
  const known = useMemo(() => new Set(titles.map(titleKey)), [titles]);

  const host = useMemo<NoteEditorHost>(
    () => ({
      openNote: (title) => void latest.current.openNote(title),
      openEntity: (table, id) => void latest.current.openEntity(table, id),
      toggleTask: (id, done) => void latest.current.toggleTask(id, done),
      noteExists: (title) => known.has(titleKey(title)),
      suggest: (query) => latest.current.suggest(query),
      makeTask: (title, done) => {
        const ticket = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        tickets.current.set(ticket, done);
        void latest.current.makeTask(title, ticket);
      },
    }),
    [known],
  );

  const style = Object.entries(theme).map(([name, value]) => `${name}: ${value};`).join(" ");
  const css = `
    :root { ${style} color-scheme: ${theme["--scheme"] ?? "light"}; }
    html, body, #root { margin: 0; height: 100%; background: transparent; color: var(--foreground); -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
    body { font-family: -apple-system, system-ui, sans-serif; }
    .note-editor { --note-gutter: 24px; --note-body-size: 1.0625rem; --note-body-line: 1.75rem; --note-title-size: 1.875rem; --note-title-line: 2.25rem; }
    .note-editor .cm-content { padding-top: ${top}px; padding-bottom: ${bottom}px; }
    .note-editor .cm-scroller { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  `;

  return (
    <>
      <style>{css}</style>
      <NoteEditor
        doc={doc}
        host={host}
        chips={chipMap}
        notesVersion={known.size}
        size="reading"
        autoFocus={autoFocus}
        titled={titled}
        placeholder={placeholder}
        label={label}
      />
    </>
  );
}

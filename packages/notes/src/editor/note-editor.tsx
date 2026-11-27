"use client";

import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderText } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";
import { entityLinkPattern, formatEntityLink, noteLinkPattern, type EntityTable } from "@lifeos/notes/markdown";
import { NOTE_TEXT } from "@lifeos/notes/protocol";
import { chipField, hostFacet, notePreview, notesChanged, setChips, titledFacet, type ChipInfo, type EditorHost } from "./live-preview";
import "./note-editor.css";

export type LinkOption = { kind: "note"; title: string } | { kind: "entity"; table: EntityTable; id: string; title: string };

export type NoteEditorHost = EditorHost & {
  suggest: (query: string) => Promise<LinkOption[]>;
  makeTask: (title: string, done: { saved: (taskId: string) => void; undone: () => void }) => void;
};

const makeTaskOrigin = Symbol("make-task");
const todoLine = /^(\s*)([-*+]) \[ \] (.+)$/;

const DETAIL = { tasks: "Task", projects: "Project", areas: "Area" } as const;

const linkSource = (host: () => NoteEditorHost) => async (context: CompletionContext) => {
  const match = context.matchBefore(/\[\[[^\]\n]*/);
  if (!match) return null;
  const query = match.text.slice(2);
  const after = context.state.sliceDoc(context.pos, context.pos + 2);
  const to = after === "]]" ? context.pos + 2 : context.pos;
  const found = await host().suggest(query);
  if (context.aborted) return null;
  const options: Completion[] = found.map((option, index) =>
    option.kind === "note"
      ? { label: option.title, detail: "Note", boost: 99 - index, apply: `[[${option.title}]]` }
      : {
          label: option.title,
          detail: DETAIL[option.table],
          boost: 49 - index,
          apply: formatEntityLink({ table: option.table, id: option.id, alias: option.title }),
        },
  );
  const fresh = query.trim();
  if (fresh.length > 0) options.push({ label: `New note “${fresh}”`, detail: "Create", boost: -99, apply: `[[${fresh}]]` });
  return { from: match.from, to, options, filter: false };
};

const actOnLine = (host: () => NoteEditorHost) => (view: EditorView) => {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const box = /^(\s*[-*+] \[)([ xX])\]/.exec(line.text);
  if (box) {
    const at = line.from + (box[1]?.length ?? 0);
    view.dispatch({ changes: { from: at, to: at + 1, insert: box[2] === " " ? "x" : " " } });
    return true;
  }
  const offset = head - line.from;
  for (const match of line.text.matchAll(entityLinkPattern)) {
    const start = match.index ?? 0;
    if (offset < start || offset > start + match[0].length) continue;
    const table = ({ task: "tasks", project: "projects", area: "areas" } as const)[match[1] as "task" | "project" | "area"];
    host().openEntity(table, match[2] ?? "");
    return true;
  }
  for (const match of line.text.matchAll(noteLinkPattern)) {
    const start = match.index ?? 0;
    if (offset < start || offset > start + match[0].length) continue;
    host().openNote((match[1] ?? "").trim());
    return true;
  }
  return false;
};

const makeTaskCommand = (ytext: Y.Text, host: () => NoteEditorHost) => (view: EditorView) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const match = todoLine.exec(line.text);
  if (!match) return false;
  const [, indent = "", bullet = "-", title = ""] = match;
  const anchor = Y.createRelativePositionFromTypeIndex(ytext, line.from);
  const original = line.text;
  const locate = (expected: string) => {
    const at = Y.createAbsolutePositionFromRelativePosition(anchor, ytext.doc!);
    if (!at) return null;
    const text = ytext.toString();
    return text.slice(at.index, at.index + expected.length) === expected ? at.index : null;
  };
  let written = "";
  host().makeTask(title.trim(), {
    saved: (taskId) => {
      const at = locate(original);
      if (at === null) return;
      written = `${indent}${bullet} ${formatEntityLink({ table: "tasks", id: taskId, alias: title.trim() })}`;
      ytext.doc!.transact(() => {
        ytext.delete(at, original.length);
        ytext.insert(at, written);
      }, makeTaskOrigin);
    },
    undone: () => {
      if (!written) return;
      const at = locate(written);
      if (at === null) return;
      ytext.doc!.transact(() => {
        ytext.delete(at, written.length);
        ytext.insert(at, original);
      }, makeTaskOrigin);
    },
  });
  return true;
};

export const NoteEditor = ({
  doc,
  host,
  chips,
  notesVersion,
  size = "reading",
  autoFocus = false,
  titled = true,
  placeholder = "Start with a title",
  label = "Note",
}: {
  doc: Y.Doc;
  host: NoteEditorHost;
  chips: ReadonlyMap<string, ChipInfo>;
  notesVersion: number;
  size?: "reading" | "compact";
  autoFocus?: boolean;
  titled?: boolean;
  placeholder?: string;
  label?: string;
}) => {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const hostRef = useRef(host);
  const first = useRef({ placeholder, label, autoFocus, titled });
  const titledSlot = useRef(new Compartment());
  useLayoutEffect(() => {
    hostRef.current = host;
  }, [host]);

  useEffect(() => {
    if (!parent.current) return;
    const ytext = doc.getText(NOTE_TEXT);
    const undoManager = new Y.UndoManager(ytext);
    const proxy: NoteEditorHost = {
      openNote: (title) => hostRef.current.openNote(title),
      openEntity: (table, id) => hostRef.current.openEntity(table, id),
      toggleTask: (id, done) => hostRef.current.toggleTask(id, done),
      noteExists: (title) => hostRef.current.noteExists(title),
      suggest: (query) => hostRef.current.suggest(query),
      makeTask: (title, done) => hostRef.current.makeTask(title, done),
    };
    const created = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": first.current.label, spellcheck: "true", autocapitalize: "sentences" }),
          placeholderText(first.current.placeholder),
          hostFacet.of(proxy),
          titledSlot.current.of(titledFacet.of(first.current.titled)),
          notePreview(),
          yCollab(ytext, null, { undoManager }),
          autocompletion({ override: [linkSource(() => proxy)], icons: false, activateOnTyping: true }),
          keymap.of([{ key: "Mod-Enter", run: makeTaskCommand(ytext, () => proxy) }, { key: "Alt-Enter", run: actOnLine(() => proxy) }, ...yUndoManagerKeymap, indentWithTab, ...defaultKeymap]),
        ],
      }),
    });
    view.current = created;
    if (first.current.autoFocus) created.focus();
    return () => {
      created.destroy();
      undoManager.destroy();
      view.current = null;
    };
  }, [doc]);

  useEffect(() => {
    view.current?.dispatch({ effects: titledSlot.current.reconfigure(titledFacet.of(titled)) });
  }, [titled]);

  useEffect(() => {
    view.current?.contentDOM.setAttribute("aria-label", label);
  }, [label]);

  useEffect(() => {
    const current = view.current;
    if (!current || current.state.field(chipField) === chips) return;
    current.dispatch({ effects: setChips.of(chips) });
  }, [chips]);

  useEffect(() => {
    view.current?.dispatch({ effects: notesChanged.of(notesVersion) });
  }, [notesVersion]);

  return <div ref={parent} className="note-editor" data-size={size} />;
};

export const focusEnd = (container: HTMLElement | null) => {
  const content = container?.querySelector<HTMLElement>(".cm-content");
  if (!content) return;
  const editor = EditorView.findFromDOM(content);
  if (!editor) return;
  editor.focus();
  editor.dispatch({ selection: { anchor: editor.state.doc.length } });
};

export { chipField, hostFacet, notePreview, setChips, titledFacet, type ChipInfo, type EditorHost } from "./live-preview";

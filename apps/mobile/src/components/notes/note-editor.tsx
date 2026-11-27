import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import * as Y from "yjs";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { ChipInfo, LinkOption } from "@lifeos/notes/editor";
import { nothing } from "@lifeos/backend/client/updaters";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useKit } from "@/lib/kit";
import { usePlanner } from "@/lib/kit-theme";
import { areaHref, projectHref, taskHref } from "@/lib/route";
import { fromBase64, toBase64 } from "@/lib/notes/base64";
import type { EditorHandle, EditorTheme, TaskEvent } from "@/lib/notes/bridge";
import { domOrigin } from "@/lib/notes/library";
import EditorDom from "./editor-dom";

export type NoteEditorProps = {
  doc: Y.Doc;
  chips: ChipInfo[];
  titles: string[];
  titled: boolean;
  placeholder: string;
  label: string;
  top: number;
  bottom: number;
  autoFocus: boolean;
  folder: { table: "areas" | "projects"; id: string } | null;
  suggest: (query: string) => Promise<LinkOption[]>;
  openTitle: (title: string) => void;
  editorRef: Ref<EditorHandle>;
  onFocus: (focused: boolean) => void;
};

const useEditorTheme = () => {
  const { colors, dark } = useKit();
  const tones = usePlanner();
  return useMemo<EditorTheme>(
    () => ({
      "--scheme": dark ? "dark" : "light",
      "--foreground": colors.foreground,
      "--muted-foreground": colors.mutedForeground,
      "--faint-foreground": tones.faintForeground,
      "--brand": colors.accent,
      "--brand-foreground": colors.accentForeground,
      "--background": colors.background,
      "--popover": colors.popover,
      "--surface-inset": tones.surfaceInset,
      "--positive": colors.success,
      "--button-secondary": dark ? "linear-gradient(180deg, #1f2023, #28292d)" : "linear-gradient(180deg, #e6e2da, #eeeae3)",
      "--shadow-float": dark ? "0 18px 44px -14px rgba(0,0,0,0.8)" : "0 18px 44px -14px rgba(60,45,25,0.32)",
      "--font-sans": "-apple-system, system-ui, sans-serif",
      "--font-mono": "ui-monospace, Menlo, monospace",
      "--ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
      "--dur-fast": "160ms",
      "--dur-press": "120ms",
      ...Object.fromEntries(Object.entries(tones.area).map(([name, value]) => [`--area-${name}`, value])),
    }),
    [colors, dark, tones],
  );
};

const FLUSH_MS = 16;

export const NoteEditorView = ({ doc, chips, titles, titled, placeholder, label, top, bottom, autoFocus, folder, suggest, openTitle, editorRef, onFocus }: NoteEditorProps) => {
  const router = useRouter();
  const theme = useEditorTheme();
  const initial = useMemo(() => toBase64(Y.encodeStateAsUpdate(doc)), [doc]);
  const [incoming, setIncoming] = useState<{ seq: number; update: string } | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const outbox = useRef<Uint8Array[]>([]);
  const sent = useRef(new Map<number, number>());
  const seq = useRef(0);
  const eventId = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      timer = null;
      if (outbox.current.length === 0) return;
      const merged = outbox.current.length === 1 ? outbox.current[0]! : Y.mergeUpdates(outbox.current);
      seq.current += 1;
      sent.current.set(seq.current, outbox.current.length);
      setIncoming({ seq: seq.current, update: toBase64(merged) });
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === domOrigin) return;
      outbox.current.push(update);
      timer ??= setTimeout(push, FLUSH_MS);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [doc]);

  const onAck = useCallback(async (acked: number) => {
    const count = sent.current.get(acked);
    if (count === undefined) return;
    outbox.current.splice(0, count);
    for (const key of sent.current.keys()) if (key <= acked) sent.current.delete(key);
  }, []);

  const onUpdate = useCallback(
    async (update: string) => {
      Y.applyUpdate(doc, fromBase64(update), domOrigin);
    },
    [doc],
  );

  const raise = useCallback((event: Omit<TaskEvent, "id">) => {
    eventId.current += 1;
    setEvents((all) => [...all.slice(-19), { ...event, id: eventId.current }]);
  }, []);

  const makeTask = useCallback(
    async (title: string, ticket: number) => {
      const parent = folder?.table === "projects" ? { kind: "project" as const, projectId: folder.id as Id<"projects"> } : folder?.table === "areas" ? { kind: "area" as const, areaId: folder.id as Id<"areas"> } : undefined;
      haptic("toggle");
      void change({
        title: "Task made from the note",
        mutation: api.planner.tasks.create,
        args: { title, ...(parent ? { parent } : {}) },
        apply: nothing,
        revert: nothing,
        onSaved: ({ taskId }) => raise({ ticket, kind: "saved", taskId }),
        onUndo: () => raise({ ticket, kind: "undone" }),
      });
    },
    [folder, raise],
  );

  const toggleTask = useCallback(async (taskId: string, done: boolean) => {
    haptic(done ? "complete" : "toggle");
    void change({
      title: done ? "Task completed" : "Task reopened",
      mutation: done ? api.planner.tasks.complete : api.planner.tasks.uncomplete,
      args: { taskId: taskId as Id<"tasks"> },
      apply: nothing,
      revert: nothing,
    });
  }, []);

  const openEntity = useCallback(
    async (table: "tasks" | "projects" | "areas", id: string) => {
      if (table === "tasks") router.push(taskHref(id as Id<"tasks">));
      if (table === "projects") router.push(projectHref(id as Id<"projects">));
      if (table === "areas") router.push(areaHref(id as Id<"areas">));
    },
    [router],
  );

  const openNote = useCallback(async (title: string) => openTitle(title), [openTitle]);

  const dom = useMemo(
    () => ({
      style: { flex: 1, backgroundColor: "transparent" },
      containerStyle: { flex: 1, backgroundColor: "transparent" },
      scrollEnabled: false,
      bounces: false,
      hideKeyboardAccessoryView: true,
      keyboardDisplayRequiresUserAction: false,
      contentInsetAdjustmentBehavior: "never" as const,
      automaticallyAdjustContentInsets: false,
    }),
    [],
  );

  return (
    <EditorDom
      ref={editorRef}
      dom={dom}
      initial={initial}
      incoming={incoming}
      events={events}
      chips={chips}
      titles={titles}
      titled={titled}
      placeholder={placeholder}
      label={label}
      theme={theme}
      top={top}
      bottom={bottom}
      autoFocus={autoFocus}
      onUpdate={onUpdate}
      onAck={onAck}
      suggest={suggest}
      makeTask={makeTask}
      toggleTask={toggleTask}
      openEntity={openEntity}
      openNote={openNote}
      onFocusChange={async (focused) => onFocus(focused)}
    />
  );
};

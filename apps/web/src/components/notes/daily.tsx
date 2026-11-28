"use client";

import { ArrowRight, BookOpen, CaretLeft, CaretRight, Kanban, X } from "@phosphor-icons/react";
import { useConvex, useQuery } from "convex/react";
import { Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useRef, useState } from "react";
import * as Y from "yjs";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { formatEntityLink, type FolderRef } from "@lifeos/notes/markdown";
import { Button, IconButton } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { DayMeter, type MeterSlice } from "@/components/lifeos/capacity";
import { formatMinutes } from "@/components/lifeos/format";
import { EstimateChip, StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { showUndo } from "@/components/lifeos/undo";
import { toast } from "@/components/ui/toast-stack";
import { cn } from "@/lib/utils";
import { registry } from "../../lib/atoms";
import { atomRuntime } from "../../lib/runtime";
import { valueOf } from "../app/hooks";
import { useShell } from "../app/shell-context";
import { useNoteActions } from "./actions";
import { dailyDocId, ensureDaily, openNote, textOf } from "./library";

const dayTitle = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

export const DayHeader = ({ date, size }: { date: string; size: "reading" | "compact" }) => {
  const shell = useShell();
  const actions = useNoteActions();
  const view = valueOf(useQuery(api.planner.today.get, { date }));
  const tasks = view ? [...view.tasks, ...view.evening] : [];
  const slices: MeterSlice[] = tasks.map((task) => ({ id: task._id, colour: task.area?.colour, minutes: task.estimateMinutes ?? 0, guess: false }));
  const planned = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  const isToday = date === shell.today;
  return (
    <div className={cn("mx-auto w-full max-w-[49.75rem] pt-6", size === "compact" ? "px-6" : "px-6 min-[672px]:px-12")}>
      <div className="flex items-center gap-2.5 text-small text-muted-foreground">
        <p className="flex items-baseline gap-2.5">
          {dayTitle(date)}
          {isToday && <span className="text-brand">Today</span>}
        </p>
        <Button variant="quiet" size="sm" icon={Kanban} className="-my-1 ml-auto h-7 px-2.5" onClick={() => shell.navigate({ kind: "planner" }, "pointer")}>
          Planner
        </Button>
      </div>
      {tasks.length > 0 && (
        <section aria-label={isToday ? "Planned today" : "Planned that day"} className="mt-3 rounded-xl bg-foreground/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {planned > 0 && <DayMeter slices={slices} goal={planned} free={planned} />}
            <span className="text-micro text-muted-foreground">
              <span className="font-mono text-foreground">{tasks.length}</span> {tasks.length === 1 ? "Task" : "Tasks"}
              {planned > 0 && (
                <>
                  , <span className="font-mono text-foreground">{formatMinutes(planned)}</span> planned
                </>
              )}
            </span>
          </div>
          <ul className="mt-2.5 space-y-0.5">
            {tasks.map((task) => {
              const done = task.status.kind === "completed";
              return (
                <li key={task._id} className="flex h-8 items-center gap-2.5">
                  <TaskCheckbox checked={done} onCheckedChange={(next) => actions.toggleTask(task._id, next)} label={task.title} />
                  <button type="button" onClick={() => void actions.openEntity("tasks", task._id)} className="min-w-0 flex-1 truncate rounded-[4px] text-left text-small">
                    <StrikeTitle struck={done}>{task.title}</StrikeTitle>
                  </button>
                  {task.estimateMinutes !== undefined && <EstimateChip minutes={task.estimateMinutes} className="h-5 text-micro" />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};

type CaptureLine = { id: number; text: string; task: boolean };

const TASK_PREFIX = /^(?:t |\[\] ?)/i;
const PAGE_KEY = "lifeos-notebook-page";
const DOT_PAPER = "bg-[radial-gradient(color-mix(in_oklab,var(--foreground)_11%,transparent)_1px,transparent_1px)] bg-[size:16px_16px]";

const shiftDay = (date: string, days: number) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toLocaleDateString("en-CA");
};

const pageAtom = Atom.kvs({ runtime: atomRuntime, key: PAGE_KEY, schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), defaultValue: () => 1 }).pipe(
  Atom.keepAlive,
);

const readPage = () => registry.get(pageAtom);

const savePage = (page: number) => registry.set(pageAtom, page);

export const NotebookCapture = ({ doc: dayDoc, date, folder, onClose }: { doc: Y.Doc; date: string; folder: FolderRef | null; onClose: () => void }) => {
  const convex = useConvex();
  const shell = useShell();
  const nextId = useRef(2);
  const fields = useRef(new Map<number, HTMLInputElement>());
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(readPage);
  const [pageField, setPageField] = useState(() => String(readPage()));
  const [lines, setLines] = useState<CaptureLine[]>([{ id: 1, text: "", task: false }]);
  const [saved, setSaved] = useState<number | null>(null);
  const day = shiftDay(date, offset);
  const written = lines.filter((line) => line.text.trim() !== "");
  const taskCount = written.filter((line) => line.task).length;
  const focus = (id: number) => requestAnimationFrame(() => fields.current.get(id)?.focus());

  const addAfter = (index: number) => {
    const id = nextId.current++;
    setLines((current) => [...current.slice(0, index + 1), { id, text: "", task: false }, ...current.slice(index + 1)]);
    focus(id);
  };

  const removeAt = (index: number) => {
    const previous = lines[index - 1];
    if (!previous) return;
    setLines((current) => current.filter((_, at) => at !== index));
    focus(previous.id);
  };

  const finish = async () => {
    if (written.length === 0) return;
    const target = offset === 0 ? null : openNote(dailyDocId(day));
    if (target) await target.ready;
    const doc = target?.doc ?? dayDoc;
    ensureDaily(doc, day);
    const parent =
      folder?.table === "projects"
        ? { kind: "project" as const, projectId: folder.id as Id<"projects"> }
        : folder?.table === "areas"
          ? { kind: "area" as const, areaId: folder.id as Id<"areas"> }
          : undefined;
    const results = await Promise.all(
      written.map(async (line) => {
        if (!line.task) return { line, taskId: null, activityId: null };
        const result = await convex
          .mutation(api.planner.tasks.create, { title: line.text.trim(), when: { kind: "scheduled", date: day, evening: false }, ...(parent ? { parent } : {}) })
          .catch(() => null);
        return result?.ok ? { line, taskId: result.value.taskId as string, activityId: result.value.activityId } : { line, taskId: null, activityId: null };
      }),
    );
    const body = results
      .map(({ line, taskId }) =>
        line.task && taskId ? `- ${formatEntityLink({ table: "tasks", id: taskId, alias: line.text.trim() })}` : line.task ? `- [ ] ${line.text.trim()}` : line.text.trim(),
      )
      .join("\n");
    const ytext = textOf(doc);
    const lead = ytext.length === 0 || ytext.toString().endsWith("\n\n") ? "" : ytext.toString().endsWith("\n") ? "\n" : "\n\n";
    const block = `${lead}### Notebook, page ${page}\n${body}\n`;
    const start = ytext.length;
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, start);
    doc.transact(() => ytext.insert(start, block));
    const pageBefore = page;
    const id = nextId.current++;
    setSaved(page);
    setLines([{ id, text: "", task: false }]);
    setPage(page + 1);
    setPageField(String(page + 1));
    savePage(page + 1);
    focus(id);
    showUndo(`Page ${pageBefore} added to ${day === shell.today ? "today" : day}`, () => {
      const at = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
      if (at && ytext.toString().slice(at.index, at.index + block.length) === block) doc.transact(() => ytext.delete(at.index, block.length));
      for (const { activityId } of results) {
        if (activityId) void convex.mutation(api.platform.undo.undo, { activityId }).catch(() => toast.error("A Task could not be undone"));
      }
      setPage(pageBefore);
      setPageField(String(pageBefore));
      savePage(pageBefore);
      setSaved(null);
    });
  };

  return (
    <div
      role="dialog"
      aria-label="Notebook page"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="fixed inset-x-3 bottom-3 z-30 mx-auto w-auto max-w-[30rem] overflow-hidden rounded-2xl bg-popover shadow-float animate-dialog-in min-[672px]:absolute min-[672px]:right-6 min-[672px]:bottom-6 min-[672px]:left-auto min-[672px]:w-[30rem]"
    >
      <div className="flex h-12 items-center gap-1 pr-2 pl-4">
        <BookOpen weight="fill" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="ml-1.5 flex-1 truncate text-small font-medium">From the notebook</span>
        <IconButton icon={CaretLeft} iconWeight="bold" label="Earlier day" onClick={() => setOffset(offset - 1)} className="size-7" />
        <span className="w-[5.25rem] text-center text-small">{new Date(`${day}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</span>
        <IconButton icon={CaretRight} iconWeight="bold" label="Later day" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} className="size-7" />
        <label className="ml-1 flex h-7 items-center gap-1 rounded-md bg-foreground/[0.06] px-2 font-mono text-small text-muted-foreground focus-within:bg-foreground/[0.1]">
          p.
          <input
            type="text"
            inputMode="numeric"
            name="notebook-page"
            aria-label="Notebook page"
            autoComplete="off"
            value={pageField}
            onChange={(event) => {
              const digits = event.target.value.replaceAll(/\D/g, "").slice(0, 3);
              setPageField(digits);
              if (digits) setPage(Number(digits));
            }}
            onBlur={() => setPageField(String(page))}
            className="w-[3ch] bg-transparent text-foreground outline-none"
          />
        </label>
        <IconButton icon={X} iconWeight="bold" label="Close" onClick={onClose} className="size-7" />
      </div>
      <ol className={cn("mx-1.5 rounded-xl bg-foreground/[0.03] px-3 py-2", DOT_PAPER)}>
        {lines.map((line, index) => {
          const setLine = (next: Partial<CaptureLine>) => setLines((current) => current.map((other) => (other.id === line.id ? { ...other, ...next } : other)));
          return (
            <li key={line.id} className="-mx-1.5 flex h-9 items-center gap-2.5 rounded-lg px-1.5 transition-colors duration-(--dur-fast) focus-within:bg-foreground/[0.045]">
              <span aria-hidden="true" className="grid size-[18px] shrink-0 place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-(--dur-base) *:ease-out">
                <span className={cn("size-[5px] rounded-full bg-foreground/35", line.task && "scale-50 opacity-0")} />
                <span className={cn("size-[18px] rounded-[6px] shadow-[inset_0_0_0_1.5px] shadow-foreground/30", !line.task && "scale-50 opacity-0")} />
              </span>
              <input
                ref={(node) => {
                  if (node) fields.current.set(line.id, node);
                  else fields.current.delete(line.id);
                }}
                type="text"
                name={`notebook-line-${line.id}`}
                aria-label={`Line ${index + 1}${line.task ? ", a Task" : ""}`}
                autoComplete="off"
                autoFocus={index === 0}
                value={line.text}
                placeholder={index === lines.length - 1 ? "Next line…" : ""}
                onChange={(event) => {
                  const prefix = line.task ? null : TASK_PREFIX.exec(event.target.value);
                  setLine(prefix ? { text: event.target.value.slice(prefix[0].length), task: true } : { text: event.target.value });
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return void finish();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAfter(index);
                  }
                  if (event.key === "Backspace" && line.task && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                    event.preventDefault();
                    return setLine({ task: false });
                  }
                  if (event.key === "Backspace" && line.text === "") {
                    event.preventDefault();
                    removeAt(index);
                  }
                  if (event.key === "ArrowDown") focus(lines[index + 1]?.id ?? line.id);
                  if (event.key === "ArrowUp") focus(lines[index - 1]?.id ?? line.id);
                }}
                className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint-foreground"
              />
              {line.task && <span className="animate-fade-in rounded-full bg-(image:--button-secondary) px-2 text-micro leading-5 font-medium text-muted-foreground">Task</span>}
            </li>
          );
        })}
      </ol>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-2 pl-4">
        <p className="min-w-0 flex-1 text-micro text-pretty text-muted-foreground" aria-live="polite">
          {saved !== null && written.length === 0 ? (
            <>
              Page <span className="font-mono">{saved}</span> is in. Keep going with page <span className="font-mono">{page}</span>.
            </>
          ) : (
            <>
              <span className="font-mono">{written.length}</span> {written.length === 1 ? "line" : "lines"}
              {taskCount > 0 && (
                <>
                  , <span className="font-mono">{taskCount}</span> as {taskCount === 1 ? "a Task" : "Tasks"}
                </>
              )}
              . Start a line with <kbd className="font-mono text-foreground/80">t</kbd> to make it a Task.
            </>
          )}
        </p>
        <span className="flex items-center gap-2">
          <KeyCombo keys="mod+enter" />
          <Button variant="primary" size="sm" icon={ArrowRight} iconWeight="bold" disabled={written.length === 0} onClick={() => void finish()}>
            Add page
          </Button>
        </span>
      </div>
    </div>
  );
};

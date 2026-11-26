"use client";

import { ArrowRight, BookOpen, CaretLeft, CaretRight, Kanban } from "@phosphor-icons/react";
import { use, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { Tag } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast-stack";
import { DayMeter, type MeterSlice } from "@/components/lifeos/capacity";
import { formatMinutes } from "@/components/lifeos/format";
import { EstimateChip, StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { showUndo } from "@/components/lifeos/undo";
import { cn } from "@/lib/utils";
import { TASK_IDS, type NotebookPage, type NoteId } from "./model";
import { NOTE_TYPE, NoteProse, NotesContext } from "./prose";
import { AREAS, NOTES, TASKS, WRITTEN_DAYS } from "./sample";

const DOT_PAPER = "bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_11%,transparent)_1px,transparent_1.5px)] bg-[size:16px_16px]";

export const NotebookPages = ({ pages, className }: { pages: NotebookPage[]; className?: string }) => (
  <section aria-label="From the notebook" className={cn("overflow-hidden rounded-xl bg-foreground/[0.03]", className)}>
    <div className={cn("px-4 pt-3 pb-4", DOT_PAPER)}>
      {pages.map((page, index) => (
        <div key={page.page} className={cn(index > 0 && "mt-4")}>
          <p className="flex items-center gap-2 text-small font-medium text-muted-foreground">
            <BookOpen weight="fill" className="size-4" aria-hidden="true" />
            <span className="flex-1">From the notebook</span>
            <Tag className="bg-surface-inset">p. {page.page}</Tag>
          </p>
          <ul className="mt-2 text-body">
            {page.lines.map((line) => (
              <li key={line} className="text-pretty">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </section>
);

const WEEK = [
  { day: 16, name: "Mon", note: undefined },
  { day: 17, name: "Tue", note: "day-17" },
  { day: 18, name: "Wed", note: "day-18" },
  { day: 19, name: "Thu", note: "day-19" },
  { day: 20, name: "Fri", note: undefined },
  { day: 21, name: "Sat", note: undefined },
  { day: 22, name: "Sun", note: undefined },
] as const satisfies readonly { day: number; name: string; note: NoteId | undefined }[];

const TODAY_DAY = 19;

export const WeekStrip = ({ selected, onSelect }: { selected: NoteId; onSelect: (id: NoteId) => void }) => (
  <div role="group" aria-label="Days this week" className="grid grid-cols-7 gap-1">
    {WEEK.map(({ day, name, note }) => {
      const current = note === selected;
      const written = WRITTEN_DAYS.has(day);
      return (
        <button
          key={day}
          type="button"
          aria-pressed={current}
          aria-label={`${name} ${day} November${written ? ", written" : ""}`}
          disabled={!note}
          onClick={note ? () => onSelect(note) : undefined}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-xl py-2 transition-[background-color,scale] duration-(--dur-press) ease-out enabled:active:scale-[0.96]",
            current ? "bg-foreground/[0.08]" : "enabled:hover:bg-foreground/[0.04]",
          )}
        >
          <span className="text-micro text-faint-foreground">{name}</span>
          <span className={cn("text-small tabular-nums", day === TODAY_DAY ? "font-semibold text-brand" : day > TODAY_DAY ? "text-faint-foreground" : "text-foreground")}>{day}</span>
          <span
            aria-hidden="true"
            className={cn("mt-0.5 size-1.5 rounded-full", written ? (day === TODAY_DAY ? "bg-brand" : "bg-foreground/55") : "shadow-[inset_0_0_0_1px] shadow-foreground/20")}
          />
        </button>
      );
    })}
  </div>
);

const MONTH_DAYS = Array.from({ length: 30 }, (_, index) => index + 1);

export const MonthDots = ({ className }: { className?: string }) => {
  const written = MONTH_DAYS.filter((day) => day <= TODAY_DAY && WRITTEN_DAYS.has(day)).length;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <span role="img" aria-label={`${written} of ${TODAY_DAY} days written this November`} className="flex flex-wrap gap-x-[7px] gap-y-1.5">
        {[0, 7, 14, 21, 28].map((start) => (
          <span key={start} className="flex gap-[3px]">
            {MONTH_DAYS.slice(start, start + 7).map((day) => (
              <span
                key={day}
                className={cn(
                  "size-1.5 rounded-full",
                  day > TODAY_DAY ? "bg-foreground/[0.045]" : WRITTEN_DAYS.has(day) ? (day === TODAY_DAY ? "bg-brand" : "bg-foreground/55") : "bg-foreground/[0.11]",
                )}
              />
            ))}
          </span>
        ))}
      </span>
      <span className="text-micro text-muted-foreground">
        <span className="font-mono">{written}</span> of <span className="font-mono">{TODAY_DAY}</span> days written in November
      </span>
    </div>
  );
};

const PLANNED = TASK_IDS.filter((id) => TASKS[id].when === "Today");
const FREE_MINUTES = 375;
const GOAL_MINUTES = 360;

const PlannerTie = () => {
  const { taskDone, toggleTask, openEntity } = use(NotesContext);
  const slices: MeterSlice[] = PLANNED.map((id) => ({ id, colour: AREAS[TASKS[id].area].colour, minutes: TASKS[id].estimate ?? 0, guess: false }));
  const planned = slices.reduce((sum, slice) => sum + slice.minutes, 0);
  return (
    <section aria-label="Planned today" className="rounded-xl bg-foreground/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DayMeter slices={slices} goal={GOAL_MINUTES} free={FREE_MINUTES} />
        <span className="text-micro text-muted-foreground">
          <span className="font-mono text-foreground">{formatMinutes(FREE_MINUTES - planned)}</span> left of <span className="font-mono">{formatMinutes(FREE_MINUTES)}</span> free
        </span>
        <Button variant="quiet" size="sm" icon={Kanban} className="-my-1 ml-auto h-7 px-2.5" onClick={() => toast("Opens Thursday in the Planner", { id: "open-planner" })}>
          Planner
        </Button>
      </div>
      <ul className="mt-2.5 space-y-0.5">
        {PLANNED.map((id) => (
          <li key={id} className="flex h-8 items-center gap-2.5">
            <TaskCheckbox checked={taskDone(id)} onCheckedChange={() => toggleTask(id)} label={`Complete ${TASKS[id].title}`} />
            <button type="button" onClick={() => openEntity({ kind: "task", id })} className="min-w-0 flex-1 truncate rounded-[4px] text-left text-small">
              <StrikeTitle struck={taskDone(id)}>{TASKS[id].title}</StrikeTitle>
            </button>
            {TASKS[id].estimate !== undefined && <EstimateChip minutes={TASKS[id].estimate} className="h-5 text-micro" />}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const DailyNote = ({ className }: { className?: string }) => {
  const [selected, setSelected] = useState<NoteId>("day-19");
  const note = NOTES[selected];
  const today = selected === "day-19";
  return (
    <div className={cn("w-full max-w-[34rem]", className)}>
      <WeekStrip selected={selected} onSelect={setSelected} />
      <div key={selected} className="mt-6 animate-fade-in">
        <h4 className={cn("flex flex-wrap items-baseline gap-x-2.5", NOTE_TYPE.compact.title)}>
          {note.title}
          {today && <span className="text-small font-normal tracking-normal text-brand">Today</span>}
        </h4>
        {today && (
          <div className="mt-4">
            <PlannerTie />
          </div>
        )}
        <NoteProse blocks={note.blocks} size="compact" className="mt-5" editor={{ todoDone: () => false, onToggleTodo: () => {} }} />
        {note.notebook && <NotebookPages pages={note.notebook} className="mt-5" />}
      </div>
      <MonthDots className="mt-6" />
    </div>
  );
};

type CaptureLine = { id: number; text: string; task: boolean };

const TASK_PREFIX = /^(?:t |\[\] ?)/i;

const DAYS = ["Tue 17 Nov", "Wed 18 Nov", "Thu 19 Nov"] as const;

export const NotebookCapture = ({ className }: { className?: string }) => {
  const nextId = useRef(4);
  const fields = useRef(new Map<number, HTMLInputElement>());
  const [dayIndex, setDayIndex] = useState(2);
  const [page, setPage] = useState(43);
  const [lines, setLines] = useState<CaptureLine[]>([
    { id: 1, text: "Reading group moves to Fridays", task: false },
    { id: 2, text: "Email Dr Nguyen the small-index numbers", task: true },
    { id: 3, text: "", task: false },
  ]);
  const [saved, setSaved] = useState<{ page: number; count: number } | null>(null);
  const day = DAYS[dayIndex]!;
  const written = lines.filter((line) => line.text.trim() !== "");
  const tasks = written.filter((line) => line.task).length;

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

  const finish = () => {
    if (written.length === 0) return;
    const before = { lines, page };
    const id = nextId.current++;
    setSaved({ page, count: written.length });
    setLines([{ id, text: "", task: false }]);
    setPage(page + 1);
    focus(id);
    showUndo(`${written.length} ${written.length === 1 ? "line" : "lines"} added to ${day}`, () => {
      setLines(before.lines);
      setPage(before.page);
      setSaved(null);
    });
  };

  return (
    <div className={cn("w-full max-w-[30rem] overflow-hidden rounded-2xl bg-popover shadow-float", className)}>
      <div className="flex h-12 items-center gap-1 pr-2 pl-4">
        <BookOpen weight="fill" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="ml-1.5 flex-1 truncate text-small font-medium @max-sm:invisible">From the notebook</span>
        <IconButton icon={CaretLeft} iconWeight="bold" label="Earlier day" disabled={dayIndex === 0} onClick={() => setDayIndex(dayIndex - 1)} className="size-7" />
        <span className="w-[5.25rem] text-center text-small">{day}</span>
        <IconButton icon={CaretRight} iconWeight="bold" label="Later day" disabled={dayIndex === DAYS.length - 1} onClick={() => setDayIndex(dayIndex + 1)} className="size-7" />
        <label className="ml-1 flex h-7 items-center gap-1 rounded-md bg-foreground/[0.06] px-2 font-mono text-small text-muted-foreground focus-within:bg-foreground/[0.1]">
          p.
          <input
            type="text"
            inputMode="numeric"
            name="notebook-page"
            aria-label="Notebook page"
            autoComplete="off"
            value={page}
            onChange={(event) => setPage(Number(event.target.value.replaceAll(/\D/g, "").slice(0, 3)) || 0)}
            className="w-[3ch] bg-transparent text-foreground outline-none"
          />
        </label>
      </div>
      <ol className={cn("mx-1.5 rounded-xl bg-foreground/[0.03] px-3 py-2", DOT_PAPER)}>
        {lines.map((line, index) => {
          const isTask = line.task;
          const setLine = (next: Partial<CaptureLine>) => setLines((current) => current.map((other) => (other.id === line.id ? { ...other, ...next } : other)));
          return (
            <li key={line.id} className="-mx-1.5 flex h-9 items-center gap-2.5 rounded-lg px-1.5 transition-colors duration-(--dur-fast) focus-within:bg-foreground/[0.045]">
              <span aria-hidden="true" className="grid size-[18px] shrink-0 place-items-center *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-(--dur-base) *:ease-out">
                <span className={cn("size-[5px] rounded-full bg-foreground/35", isTask && "scale-50 opacity-0")} />
                <span className={cn("size-[18px] rounded-[6px] shadow-[inset_0_0_0_1.5px] shadow-foreground/30", !isTask && "scale-50 opacity-0")} />
              </span>
              <input
                ref={(node) => {
                  if (node) fields.current.set(line.id, node);
                  else fields.current.delete(line.id);
                }}
                type="text"
                name={`notebook-line-${line.id}`}
                aria-label={`Line ${index + 1}${isTask ? ", a Task" : ""}`}
                autoComplete="off"
                value={line.text}
                placeholder={index === lines.length - 1 ? "Next line…" : ""}
                onChange={(event) => {
                  const prefix = line.task ? null : TASK_PREFIX.exec(event.target.value);
                  setLine(prefix ? { text: event.target.value.slice(prefix[0].length), task: true } : { text: event.target.value });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return finish();
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
              {isTask && <span className="animate-fade-in rounded-full bg-(image:--button-secondary) px-2 text-micro leading-5 font-medium text-muted-foreground">Task</span>}
            </li>
          );
        })}
      </ol>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2 pr-2 pl-4">
        <p className="min-w-0 flex-1 text-micro text-pretty text-muted-foreground" aria-live="polite">
          {saved && written.length === 0 ? (
            <>
              Page <span className="font-mono">{saved.page}</span> is in {day}. Keep going with page <span className="font-mono">{page}</span>.
            </>
          ) : (
            <>
              <span className="font-mono">{written.length}</span> {written.length === 1 ? "line" : "lines"} for {day}
              {tasks > 0 && (
                <>
                  , <span className="font-mono">{tasks}</span> as {tasks === 1 ? "a Task" : "Tasks"}
                </>
              )}
              . Start a line with <kbd className="font-mono text-foreground/80">t</kbd> to make it a Task.
            </>
          )}
        </p>
        <span className="flex items-center gap-2">
          <KeyCombo keys="mod+enter" />
          <Button variant="primary" size="sm" icon={ArrowRight} iconWeight="bold" disabled={written.length === 0} onClick={finish}>
            Add page
          </Button>
        </span>
      </div>
    </div>
  );
};

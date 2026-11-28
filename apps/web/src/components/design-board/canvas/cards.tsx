"use client";

import { Check, TerminalWindow } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { toast } from "@/components/ui/toast-stack";
import { AiMark } from "@/components/lifeos/ai-orb";
import { AreaDot } from "@/components/lifeos/area";
import { StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { AREAS, areaOf, excerptOf, placeOf, TASKS, titleOf } from "../notes/sample";
import { ROW, SOCKET_WORD, socketTop, type Card, type GroupCard, type NoteCard, type Socket, type SocketType, type StepCard, type StepState, type StepStatus, type TaskCard, type TextCard } from "./model";

const PAPER = "rounded-xl bg-popover shadow-lift";
const PENCIL = "rounded-xl border border-dashed border-foreground/35 bg-popover/55";
const INK_SHIFT = "transition-[background-color,border-color,box-shadow] duration-(--dur-slow) ease-out";

const SOCKET_SHAPE = {
  text: "rounded-full bg-current",
  number: "rounded-full border-[1.5px] border-current bg-popover",
  file: "rounded-[2px] bg-current",
  folder: "rounded-[2px] border-[1.5px] border-current bg-popover",
} as const satisfies Record<SocketType, string>;

export const SocketMark = ({ type, className }: { type: SocketType; className?: string }) => <span aria-hidden="true" className={cn("block size-2 shrink-0", SOCKET_SHAPE[type], className)} />;

const SocketRow = ({ socket, index, end, pencil }: { socket: Socket; index: number; end: "in" | "out"; pencil: boolean }) => (
  <li className={cn("absolute flex items-center gap-2 font-mono text-micro text-muted-foreground", end === "in" ? "left-0 pr-2" : "right-0 flex-row-reverse pl-2")} style={{ top: socketTop(index), height: ROW }}>
    <SocketMark type={socket.type} className={cn("shadow-[0_0_0_2px_var(--popover)]", end === "in" ? "-ml-1" : "-mr-1", pencil ? "text-foreground/40" : "text-foreground/70")} />
    <span className="truncate">
      <span className="sr-only">
        {end === "in" ? "Takes" : "Gives"} {SOCKET_WORD[socket.type].toLowerCase()}:{" "}
      </span>
      {socket.label}
    </span>
  </li>
);

export const Sockets = ({ inputs, outputs, pencil = false }: { inputs: Socket[]; outputs: Socket[]; pencil?: boolean }) => (
  <ul className="absolute inset-x-0 top-0">
    {inputs.map((socket, index) => (
      <SocketRow key={`in-${socket.id}`} socket={socket} index={index} end="in" pencil={pencil} />
    ))}
    {outputs.map((socket, index) => (
      <SocketRow key={`out-${socket.id}`} socket={socket} index={index} end="out" pencil={pencil} />
    ))}
  </ul>
);

const socketRoom = (card: { inputs: Socket[]; outputs: Socket[] }) => Math.max(card.inputs.length, card.outputs.length) * ROW + 6;

const STATE_WORD = { idle: "Not run", waiting: "Waiting", running: "Running", done: "Done", kept: "Kept", failed: "Failed" } as const satisfies Record<StepState, string>;

const StateMark = ({ state }: { state: StepState }) => (
  <span data-state={state} className="grid size-4 shrink-0 place-items-center">
    <span className="sr-only">{STATE_WORD[state]}. </span>
    {state === "idle" && <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-foreground/30" />}
    {state === "waiting" && <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-dashed border-foreground/45" />}
    {state === "running" && <span aria-hidden="true" className="size-2 animate-pending rounded-full bg-foreground motion-reduce:animate-none" />}
    {state === "done" && <Check weight="bold" className="size-3.5 text-foreground" aria-hidden="true" />}
    {state === "kept" && <Check weight="bold" className="size-3.5 text-faint-foreground" aria-hidden="true" />}
    {state === "failed" && <span aria-hidden="true" className="size-2 rounded-full bg-negative" />}
  </span>
);

const TICKS = 36;

export const Ticks = ({ done, of, className }: { done: number; of: number; className?: string }) => {
  const lit = Math.floor((done / of) * TICKS);
  return (
    <span role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={of} aria-valuenow={done} className={cn("flex h-2.5 items-end gap-[2px]", className)}>
      {Array.from({ length: TICKS }, (_, index) => (
        <span key={index} className={cn("w-[3px] flex-1 rounded-full transition-colors duration-(--dur-fast)", index % 6 === 0 ? "h-full" : "h-1.5", index < lit ? "bg-foreground" : index === lit ? "bg-foreground/45" : "bg-foreground/[0.13]")} />
      ))}
    </span>
  );
};

const Command = ({ command, values }: { command: string; values?: Record<string, string> | undefined }) => (
  <code translate="no" className="mx-2 line-clamp-2 rounded-lg bg-foreground/[0.045] px-2 py-1.5 font-mono text-[11px] leading-4 break-all text-muted-foreground">
    {command.split(/(\{[a-z]+\})/).map((piece, index) => {
      if (!piece.startsWith("{")) return piece;
      const name = piece.slice(1, -1);
      return (
        <span key={index} className="inline-block rounded-[4px] bg-foreground/[0.08] px-1 font-medium text-foreground">
          {values?.[name] ?? name}
        </span>
      );
    })}
  </code>
);

export const idleStatus = (step: StepCard) => ({ state: "idle", words: step.reach.join(" · ") || "Not run yet" }) satisfies StepStatus;

export const StepView = ({ step, status = idleStatus(step), pencil = false, values }: { step: StepCard; status?: StepStatus; pencil?: boolean; values?: Record<string, string> }) => (
  <section aria-label={`Step: ${step.title}`} data-ink={pencil ? "pencil" : "ink"} className={cn("relative flex h-full animate-fade-in flex-col", INK_SHIFT, pencil ? PENCIL : PAPER)}>
    <header className="flex h-10 shrink-0 items-center gap-2 px-3">
      <StateMark state={status.state} />
      <h4 className="min-w-0 flex-1 truncate text-small font-medium">{step.title}</h4>
      {step.runner === "claude" ? <AiMark className="size-3.5 text-muted-foreground" aria-label="Runs Claude Code" /> : <TerminalWindow weight="fill" className="size-3.5 shrink-0 text-faint-foreground" aria-label="Runs a command" />}
    </header>
    <Sockets inputs={step.inputs} outputs={step.outputs} pencil={pencil} />
    <div aria-hidden="true" className="shrink-0" style={{ height: socketRoom(step) }} />
    <Command command={step.command} values={values} />
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-3">
      {status.of !== undefined && status.done !== undefined && <Ticks done={status.done} of={status.of} />}
      <p className="truncate text-micro text-muted-foreground tabular-nums">{status.words}</p>
    </div>
  </section>
);

export const WiredCard = ({ card, title, mark, aside, footer, children }: { card: { inputs: Socket[]; outputs: Socket[] }; title: string; mark?: ReactNode; aside?: ReactNode; footer?: ReactNode; children: ReactNode }) => (
  <section aria-label={title} className={cn("relative flex h-full flex-col", PAPER)}>
    <header className="flex h-10 shrink-0 items-center gap-2 px-3">
      {mark}
      <h4 className="min-w-0 flex-1 truncate text-small font-medium">{title}</h4>
      {aside}
    </header>
    <Sockets inputs={card.inputs} outputs={card.outputs} />
    <div aria-hidden="true" className="shrink-0" style={{ height: socketRoom(card) }} />
    <div className="min-h-0 flex-1 px-2">{children}</div>
    {footer}
  </section>
);

const HANDLES = ["top-0 left-1/2", "top-1/2 left-full", "top-full left-1/2", "top-1/2 left-0"];

const Selected = () => (
  <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-fade-in rounded-xl outline-[1.5px] outline-foreground/55">
    {HANDLES.map((place) => (
      <span key={place} className={cn("absolute size-2.5 -translate-1/2 rounded-full border-[1.5px] border-foreground/55 bg-popover", place)} />
    ))}
  </span>
);

const NoteView = ({ card, selected, onSelect }: { card: NoteCard; selected: boolean; onSelect: () => void }) => {
  const area = areaOf(card.note);
  return (
    <article data-selected={selected || undefined} onPointerDown={onSelect} className={cn("relative flex h-full flex-col p-3.5", PAPER)}>
      <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
        {area && <AreaDot colour={area.colour} />}
        {placeOf(card.note)}
      </p>
      <h4 className="mt-1 text-body leading-5 font-semibold tracking-[-0.01em]">
        <button type="button" onFocus={onSelect} onClick={() => toast(`${titleOf(card.note)} opens beside the canvas`, { id: "open-note" })} className="rounded-sm text-left hover:underline">
          {titleOf(card.note)}
        </button>
      </h4>
      <p className="mt-1.5 [display:-webkit-box] overflow-hidden text-small text-muted-foreground [-webkit-box-orient:vertical]" style={{ WebkitLineClamp: Math.floor((card.h - 76) / 20) }}>
        {excerptOf(card.note)}
      </p>
      {selected && <Selected />}
    </article>
  );
};

const TextView = ({ card }: { card: TextCard }) => <p className="flex h-full items-center rounded-xl bg-foreground/[0.045] px-3.5 text-small text-pretty">{card.text}</p>;

const TaskView = ({ card, done, onToggle }: { card: TaskCard; done: boolean; onToggle: () => void }) => {
  const task = TASKS[card.task];
  return (
    <div className="flex h-full items-center gap-2 rounded-full bg-(image:--button-secondary) pr-3.5 pl-2.5 shadow-lift">
      <TaskCheckbox checked={done} onCheckedChange={onToggle} label={`Complete ${task.title}`} />
      <span className="min-w-0 flex-1 truncate text-small font-medium">
        <StrikeTitle struck={done}>{task.title}</StrikeTitle>
      </span>
      <AreaDot colour={AREAS[task.area].colour} />
    </div>
  );
};

const GroupView = ({ card }: { card: GroupCard }) => (
  <div className="h-full rounded-[1.25rem] bg-foreground/[0.035] px-4 py-3">
    <p className="text-micro font-medium text-muted-foreground">{card.label}</p>
  </div>
);

export type PlainActions = { selected: string | null; onSelect: (id: string) => void; done: ReadonlySet<string>; onToggle: (id: string) => void };

export const PlainCard = ({ card, act }: { card: Card; act: PlainActions }) => {
  if (card.kind === "note") return <NoteView card={card} selected={act.selected === card.id} onSelect={() => act.onSelect(card.id)} />;
  if (card.kind === "text") return <TextView card={card} />;
  if (card.kind === "task") return <TaskView card={card} done={act.done.has(card.id)} onToggle={() => act.onToggle(card.id)} />;
  if (card.kind === "group") return <GroupView card={card} />;
  return null;
};

export const Tick = ({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={on}
    aria-label={label}
    onClick={onToggle}
    className={cn(
      "relative grid size-4 shrink-0 place-items-center rounded-[5px] transition-[background-color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-2 active:scale-[0.86] [--ring:color-mix(in_oklab,var(--foreground)_50%,transparent)]",
      on ? "bg-foreground text-background" : "shadow-[inset_0_0_0_1.5px] shadow-foreground/30",
    )}
  >
    {on && <Check weight="bold" className="size-3" aria-hidden="true" />}
  </button>
);

export const BriefCard = ({ card }: { card: TextCard }) => (
  <article className={cn("flex h-full flex-col p-3", PAPER)}>
    <p className="text-micro text-muted-foreground">Your note</p>
    <p className="mt-1 text-small text-pretty">{card.text}</p>
  </article>
);

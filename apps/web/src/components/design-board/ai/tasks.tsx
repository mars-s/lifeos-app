"use client";

import { ArrowCounterClockwise, Star, Tag as TagIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { AiMark } from "@/components/lifeos/ai-orb";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { formatClock, formatMinutes, formatRange } from "@/components/lifeos/format";
import { DeadlineMarker, TaskCheckbox, TaskRow, type TaskSummary } from "@/components/lifeos/task-row";
import { showUndo } from "@/components/lifeos/undo";
import { cn } from "@/lib/utils";
import { Fold } from "../notes/parts";
import { Specimen } from "../specimen";
import { AskBox, useAsk, useCmdJTarget } from "./ask";
import { DayColumn, DayTrack, LoadRows } from "./graphs";
import { askShown, askVerb, type DaySpan } from "./model";
import { AI_RING, Ink, PencilBox, PencilChip, SourceChip, StreamWords, wordCount } from "./parts";
import { ASK_TASK, TASK_EMAIL, TASK_ESTIMATE, TASK_NOTES, TASK_READS, TASK_STEPS, TASK_TIME, TASK_VERBS, THURSDAY, type TaskVerb } from "./sample";

const TEXT_PACE = 45;
const ITEM_PACE = 260;
const CHIPS = [10, 15, 30, 60, 120];
const SLOTS = [TASK_TIME.start, 11 * 60, 15 * 60 + 30];

const taskPlan = (verb: TaskVerb) => {
  if (verb === "email") return { total: wordCount(TASK_EMAIL), pace: TEXT_PACE };
  if (verb === "steps") return { total: TASK_STEPS.length, pace: ITEM_PACE };
  if (verb === "related") return { total: TASK_NOTES.length, pace: ITEM_PACE };
  return { total: 1, pace: ITEM_PACE };
};

const ABOVE: TaskSummary = { id: "papers", title: "Read two papers on retrieval", area: { name: "University", colour: "violet" }, project: "Honours thesis", estimate: 60 };
const BELOW: TaskSummary[] = [
  { id: "invoice", title: "Reply to Harry about the October invoice", area: { name: "Paperless", colour: "orange" }, estimate: 15 },
  { id: "copy", title: "Review the onboarding copy", area: { name: "Korvant", colour: "teal" }, project: "Onboarding rework", estimate: 45 },
  { id: "physio", title: "Book a physio appointment", area: { name: "Personal", colour: "green" }, estimate: 10 },
  { id: "sds", title: "Check the SDS import", area: { name: "Chemwatch", colour: "rose" }, estimate: 45 },
  { id: "parcel", title: "Pick up the parcel from the post office", area: { name: "Personal", colour: "green" } },
];

const dimmed = (lit: boolean) => cn("transition-opacity duration-(--dur-base) ease-out", lit && "opacity-35");

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-2 @max-xs:grid-cols-1">
    <span className="text-small leading-7 text-muted-foreground @max-xs:leading-5">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const blockStyle = (pencil: boolean) =>
  pencil
    ? { borderStyle: "dashed", borderColor: `color-mix(in oklab, ${areaVar("violet")} 70%, transparent)`, backgroundColor: `color-mix(in oklab, ${areaVar("violet")} 6%, transparent)` }
    : { borderColor: "transparent", backgroundColor: `color-mix(in oklab, ${areaVar("violet")} 16%, transparent)` };

export const BlockChip = ({ pencil, day, start, minutes }: { pencil: boolean; day: string; start: number; minutes: number }) => (
  <span
    data-ink={pencil ? "pencil" : "ink"}
    className="inline-flex h-7 max-w-full items-center gap-2 rounded-md border pr-2 pl-1 text-small whitespace-nowrap transition-[background-color,border-color] duration-(--dur-slow) ease-out"
    style={blockStyle(pencil)}
  >
    <span aria-hidden="true" className={cn("h-4 w-[3px] rounded-full transition-opacity duration-(--dur-slow)", pencil && "opacity-0")} style={{ backgroundColor: areaVar("violet") }} />
    <Ink pencil={pencil} say>
      {day}
    </Ink>
    <Ink pencil={pencil} className="font-mono">
      {formatRange(start, start + minutes)}
    </Ink>
    <span className="font-mono text-muted-foreground @max-xs:hidden">{formatMinutes(minutes)}</span>
  </span>
);

const TaskAsk = () => {
  const root = useRef<HTMLDivElement>(null);
  const [ask, send] = useAsk(taskPlan);
  const [kept, setKept] = useState<TaskVerb[]>([]);
  const [slot, setSlot] = useState(SLOTS[0] ?? TASK_TIME.start);
  const [done, setDone] = useState(false);
  const lit = ask.phase !== "idle";
  const verb = askVerb(ask);
  const shown = askShown(ask);
  useCmdJTarget(root, () => send({ type: "open", via: "keys" }));

  const visible = (id: TaskVerb) => kept.includes(id) || (verb === id && ask.phase !== "reading");
  const pencil = (id: TaskVerb) => !kept.includes(id);
  const count = (id: TaskVerb) => (kept.includes(id) ? taskPlan(id).total : verb === id ? shown : 0);
  const verbs = TASK_VERBS.filter((candidate) => !kept.includes(candidate.id));
  const close = () => {
    send({ type: "close" });
    root.current?.focus({ preventScroll: true });
  };
  const keep = (id: TaskVerb) => {
    const before = kept;
    setKept([...kept, id]);
    close();
    const words = id === "time" ? `Planned for Thu ${formatClock(slot)}` : (TASK_VERBS.find((candidate) => candidate.id === id)?.kept ?? "Kept");
    showUndo(words, () => setKept(before), "ai-task");
  };
  const spans: DaySpan[] = TASK_TIME.spans.map((span) => (span.kind === "pencil" ? { ...span, start: slot } : span));

  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="A Task with LifeOS AI" className={cn("@container w-full max-w-[38rem] self-center outline-none", AI_RING)}>
      <div className="flex h-8 items-center gap-2 px-3">
        <Star weight="fill" className={cn("size-4 text-brand", dimmed(lit))} aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 truncate font-medium", dimmed(lit))}>Today</span>
        {kept.length > 0 && !lit && (
          <Button variant="quiet" icon={ArrowCounterClockwise} iconWeight="bold" onClick={() => setKept([])} className="h-7 px-2.5">
            Start over
          </Button>
        )}
        <Button variant="secondary" icon={AiMark} iconWeight="bold" disabled={lit || verbs.length === 0} onClick={() => send({ type: "open", via: "pointer" })} className="h-7 gap-2 pr-1.5 pl-2.5">
          Ask
          <KeyCombo keys="mod+j" />
        </Button>
      </div>
      <div className={cn("mt-1", dimmed(lit))}>
        <TaskRow task={ABOVE} completed={false} onCompletedChange={() => undefined} />
      </div>

      <div className="relative my-1.5">
        <div className="rounded-xl bg-popover p-3 shadow-lift">
          <div className="flex items-start gap-3">
            <TaskCheckbox checked={done} onCheckedChange={setDone} label={`Complete ${ASK_TASK.title}`} className="mt-[3px]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="truncate">{ASK_TASK.title}</p>
                {visible("email") ? (
                  <p className="mt-0.5 text-small text-pretty select-text">
                    <Ink pencil={pencil("email")} say>
                      <StreamWords text={TASK_EMAIL} shown={count("email")} />
                    </Ink>
                  </p>
                ) : (
                  <p className="mt-0.5 text-small text-faint-foreground">Notes</p>
                )}
              </div>
              {visible("steps") && (
                <ul aria-label="Steps" className="-ml-1.5 space-y-0.5 rounded-xl bg-foreground/[0.035] p-1.5">
                  {TASK_STEPS.slice(0, count("steps")).map((step) => (
                    <li key={step} className="flex h-7 animate-fade-in items-center gap-2.5 px-1.5 text-small">
                      {pencil("steps") ? <PencilBox round /> : <TaskCheckbox size="sm" checked={false} onCheckedChange={() => undefined} label={`Tick ${step}`} />}
                      <Ink pencil={pencil("steps")} say className="truncate">
                        {step}
                      </Ink>
                    </li>
                  ))}
                </ul>
              )}
              {visible("time") && (
                <Field label="Planned">
                  <BlockChip pencil={pencil("time")} day="Thu" start={slot} minutes={TASK_TIME.minutes} />
                  <Fold open={pencil("time")}>
                    <DayTrack day={THURSDAY.day} from={THURSDAY.from} to={THURSDAY.to} spans={spans} className="mt-2.5" />
                    <p className="mt-1 text-small text-pretty text-muted-foreground">{slot === TASK_TIME.start ? TASK_TIME.why : "A free gap between two blocks."}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1 pb-1 text-small text-muted-foreground">
                      <span className="mr-1">Or</span>
                      {SLOTS.filter((candidate) => candidate !== slot).map((candidate) => (
                        <button
                          key={candidate}
                          type="button"
                          aria-label={`Try ${formatClock(candidate)} instead`}
                          onClick={() => setSlot(candidate)}
                          className="relative h-6 rounded-md before:absolute before:-inset-y-2 before:inset-x-0 border border-dashed border-foreground/30 px-1.5 font-mono text-small text-muted-foreground transition-[color,border-color,scale] duration-(--dur-press) ease-out hover:border-foreground/50 hover:text-foreground active:scale-[0.96]"
                        >
                          {formatClock(candidate)}
                        </button>
                      ))}
                    </p>
                  </Fold>
                </Field>
              )}
              <Field label="Estimate">
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {CHIPS.map((minutes) => {
                    const guess = minutes === TASK_ESTIMATE.minutes && visible("estimate");
                    return (
                      <span key={minutes} className="relative">
                        <PencilChip pencil={guess && pencil("estimate")} className={cn("h-6", guess && !pencil("estimate") && "bg-brand text-brand-foreground")}>
                          {formatMinutes(minutes)}
                        </PencilChip>
                        {guess && pencil("estimate") && <AiMark weight="bold" aria-hidden="true" className="pointer-events-none absolute -top-1 -right-1 size-2.5 animate-fade-in text-muted-foreground" />}
                      </span>
                    );
                  })}
                </div>
                {visible("estimate") && pencil("estimate") && <p className="mt-1.5 animate-fade-in text-small text-pretty text-muted-foreground">{TASK_ESTIMATE.why}</p>}
              </Field>
              {visible("related") && (
                <Field label="Notes">
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {TASK_NOTES.slice(0, count("related")).map((id) => (
                      <SourceChip key={id} source={{ kind: "note", id }} pencil={pencil("related")} className="animate-fade-in" />
                    ))}
                  </div>
                </Field>
              )}
              <div className="flex items-center gap-2 pt-0.5 text-small">
                <Star weight="fill" className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="font-medium">Today</span>
                <span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 text-muted-foreground">
                  <AreaDot colour="violet" />
                  <span className="truncate">{ASK_TASK.project}</span>
                </span>
                <TagIcon className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <DeadlineMarker deadline={{ label: ASK_TASK.deadline }} />
              </div>
            </div>
          </div>
        </div>
        {lit && (
          <div className="absolute top-full left-0 z-20 mt-2 w-full">
            <AskBox
              ask={ask}
              verbs={verbs}
              free="steps"
              reads={TASK_READS}
              scope="Reads this Task, its Project and your calendar"
              refine="Change it: shorter, later in the day…"
              send={send}
              onKeep={keep}
              onDiscard={close}
            />
          </div>
        )}
      </div>

      <div className={dimmed(lit)}>
        {BELOW.map((task) => (
          <TaskRow key={task.id} task={task} completed={false} onCompletedChange={() => undefined} />
        ))}
      </div>
    </div>
  );
};

const FRIDAY = { from: 8 * 60, to: 17 * 60 } as const;
const FRIDAY_FIXED: DaySpan[] = [
  { id: "tutorial", title: "Prepare the tutorial", start: 9 * 60, minutes: 60, kind: "block", colour: "violet" },
  { id: "copy", title: "Rewrite the onboarding copy", start: 10 * 60 + 30, minutes: 105, kind: "block", colour: "teal" },
  { id: "lunch", title: "Lunch with Mira", start: 12 * 60 + 30, minutes: 60, kind: "commitment" },
  { id: "ferry", title: "Book the ferry to Naoshima", start: 13 * 60 + 45, minutes: 30, kind: "block", colour: "green" },
];
const FIGURE = { title: "Find one figure for related work", minutes: 45, slots: [14 * 60 + 30, 15 * 60 + 45, 8 * 60] };
const GOAL = 6 * 60;

type Placing = "idle" | "pencil" | "ink";

const PlannerAsk = () => {
  const root = useRef<HTMLDivElement>(null);
  const [placing, setPlacing] = useState<Placing>("pencil");
  const [at, setAt] = useState(0);
  const start = FIGURE.slots[at % FIGURE.slots.length] ?? 14 * 60 + 30;
  const placed = placing !== "idle";
  const spans: DaySpan[] = placed ? [...FRIDAY_FIXED, { id: "figure", title: FIGURE.title, start, minutes: FIGURE.minutes, kind: placing === "pencil" ? "pencil" : "block", colour: "violet" }] : FRIDAY_FIXED;
  const slices = [
    { id: "tutorial", colour: "violet" as const, minutes: 60, guess: false },
    { id: "copy", colour: "teal" as const, minutes: 105, guess: false },
    { id: "ferry", colour: "green" as const, minutes: 30, guess: false },
    ...(placed ? [{ id: "figure", colour: "violet" as const, minutes: FIGURE.minutes, guess: placing === "pencil" }] : []),
  ];
  const place = (next: Placing) => {
    setPlacing(next);
    root.current?.focus({ preventScroll: true });
  };
  const plan = () => {
    place("ink");
    showUndo(`Planned for Fri ${formatClock(start)}`, () => setPlacing("pencil"), "ai-planner");
  };
  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="Friday in the Planner" className={cn("@container w-full max-w-[24rem] self-center outline-none", AI_RING)}>
      <div className="flex items-baseline gap-2">
        <h4 className="text-heading font-medium">Friday</h4>
        <span className="text-small text-muted-foreground">20 Nov</span>
      </div>
      <LoadRows days={[{ label: "Fri", goal: GOAL, free: GOAL, slices }]} className="mt-2" />
      <DayColumn from={FRIDAY.from} to={FRIDAY.to} spans={spans} className="mt-4" />
      <div className="mt-4 flex min-h-8 flex-wrap items-center gap-1.5">
        {placing === "pencil" && (
          <>
            <Button variant="primary" onClick={plan}>
              Plan it
            </Button>
            <Button variant="secondary" onClick={() => setAt(at + 1)}>
              Another time
            </Button>
            <Button variant="quiet" onClick={() => place("idle")}>
              Discard
            </Button>
          </>
        )}
        {placing !== "pencil" && (
          <Button variant="secondary" icon={AiMark} iconWeight="bold" onClick={() => place("pencil")}>
            {placing === "ink" ? "Find another time" : "Find a time"}
          </Button>
        )}
        <span role="status" className="ml-auto font-mono text-small text-muted-foreground">
          {placed ? formatRange(start, start + FIGURE.minutes) : formatMinutes(FIGURE.minutes)}
        </span>
      </div>
    </div>
  );
};

type Hint = { id: string; title: string; area: string; colour: "green" | "violet"; chip: ReactNode; kept: string };

const HINTS: Hint[] = [
  { id: "parcel", title: "Pick up the parcel from the post office", area: "Personal", colour: "green", chip: "0:15", kept: "Estimate set to 0:15" },
  { id: "outline", title: "Draft the thesis outline", area: "Honours thesis", colour: "violet", chip: "Thu 2:30 pm", kept: "Planned for Thu 2:30 pm" },
  { id: "ferry", title: "Book the ferry to Naoshima", area: "Japan trip", colour: "green", chip: "0:10", kept: "Estimate set to 0:10" },
];

const Unasked = () => {
  const [kept, setKept] = useState<string[]>([]);
  return (
    <ul className={cn("w-full max-w-[26rem] self-center", AI_RING)}>
      {HINTS.map((hint) => {
        const inked = kept.includes(hint.id);
        return (
          <li key={hint.id} className="flex items-start gap-3 rounded-xl px-3 py-2.5">
            <TaskCheckbox checked={false} onCheckedChange={() => undefined} label={`Complete ${hint.title}`} className="mt-[3px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{hint.title}</span>
              <span className="flex items-center gap-1.5 text-small text-muted-foreground">
                <AreaDot colour={hint.colour} />
                {hint.area}
              </span>
            </span>
            <button
              type="button"
              aria-pressed={inked}
              aria-label={`Keep ${String(hint.chip)} for ${hint.title}`}
              onClick={() => {
                if (inked) return setKept(kept.filter((id) => id !== hint.id));
                setKept([...kept, hint.id]);
                showUndo(hint.kept, () => setKept((current) => current.filter((id) => id !== hint.id)), `ai-hint-${hint.id}`);
              }}
              className="relative rounded-md transition-[scale] duration-(--dur-press) ease-out before:absolute before:-inset-2 active:scale-[0.95]"
            >
              <PencilChip pencil={!inked}>{hint.chip}</PencilChip>
              <AiMark weight="bold" aria-hidden="true" className={cn("pointer-events-none absolute -top-1 -right-1 size-2.5 text-muted-foreground transition-opacity duration-(--dur-slow)", inked && "opacity-0")} />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export const TaskSpecimens = () => (
  <>
    <Specimen
      name="On a Task"
      note="Cmd+J on the open card. Each answer lands on the field it would fill: steps in the Checklist, a time under Planned, a figure in Estimate, the email in Notes."
      className="md:col-span-6 xl:col-span-7 xl:row-span-2"
      stage="min-h-[38rem] items-stretch justify-start px-3 sm:px-6"
    >
      <TaskAsk />
    </Specimen>
    <Specimen
      name="In the Planner"
      note="Find a time draws a pencil Work Block on the day, and hollow dots on the meter. Plan it inks both. Another time moves it."
      className="md:col-span-3 xl:col-span-5"
      stage="items-stretch justify-center"
    >
      <PlannerAsk />
    </Specimen>
    <Specimen
      name="Without asking"
      note="Small guesses wait on the field they would fill, in pencil. Press one to keep it. Leave it and nothing happens."
      className="md:col-span-3 xl:col-span-5"
      stage="items-stretch justify-center p-3 sm:p-4"
    >
      <Unasked />
    </Specimen>
  </>
);

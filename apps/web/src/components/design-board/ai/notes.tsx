"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { Segmented } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast-stack";
import { AiMark } from "@/components/lifeos/ai-orb";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { TaskCheckbox } from "@/components/lifeos/task-row";
import { showUndo } from "@/components/lifeos/undo";
import { cn } from "@/lib/utils";
import { Fold } from "../notes/parts";
import { Caret, NOTE_TYPE } from "../notes/prose";
import { titleOf } from "../notes/sample";
import { Specimen } from "../specimen";
import { AskBox, useAsk, useCmdJTarget } from "./ask";
import { askShown, askVerb, type Ask } from "./model";
import { AI_RING, Ink, MarginBar, PencilBox, PencilChip, StreamWords, wordCount } from "./parts";
import { MEETING, NOTE_DRAFTS, NOTE_READS, NOTE_TASKS, NOTE_VERBS, type NoteVerb } from "./sample";

const TEXT_PACE = 45;
const ITEM_PACE = 260;
const LINKS = MEETING.rough.filter((part) => typeof part !== "string");
const linkOrder = (index: number) => MEETING.rough.slice(0, index).filter((part) => typeof part !== "string").length;

const notePlan = (verb: NoteVerb) => {
  if (verb === "tasks") return { total: NOTE_TASKS.length, pace: ITEM_PACE };
  if (verb === "link") return { total: LINKS.length, pace: ITEM_PACE };
  return { total: wordCount(NOTE_DRAFTS[verb]), pace: TEXT_PACE };
};

const LinkMark = ({ state, note, children }: { state: "off" | "pencil" | "ink"; note: Parameters<typeof titleOf>[0]; children: ReactNode }) => {
  if (state === "off") return <span>{children}</span>;
  return (
    <button
      type="button"
      data-ink={state}
      title={`${state === "pencil" ? "Suggested link" : "Links"} to ${titleOf(note)}`}
      onClick={() => toast(`${titleOf(note)} opens`, { id: "open-source" })}
      className={cn(
        "rounded-[4px] text-left underline underline-offset-[3px] transition-[color,text-decoration-color] duration-(--dur-slow) ease-out",
        state === "pencil" ? "animate-fade-in decoration-foreground/45 decoration-dashed" : "text-brand decoration-transparent hover:decoration-brand/40",
      )}
    >
      {children}
    </button>
  );
};

export const TaskLine = ({ title, estimate, pencil, place = "Honours thesis" }: { title: string; estimate: number; pencil: boolean; place?: string }) => {
  const [done, setDone] = useState(false);
  return (
    <li className="flex animate-fade-in items-start gap-2.5">
      <span className="grid h-[1lh] shrink-0 place-items-center">{pencil ? <PencilBox /> : <TaskCheckbox checked={done} onCheckedChange={setDone} label={`Complete ${title}`} />}</span>
      <Ink pencil={pencil} say className={cn("min-w-0 flex-1", done && "text-faint-foreground line-through decoration-faint-foreground/60")}>
        {title}
        <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-small text-muted-foreground">
          <AreaDot colour="violet" />
          {place}
        </span>
      </Ink>
      <span className="grid h-[1lh] shrink-0 place-items-center">
        <PencilChip pencil={pencil}>
          <span className="sr-only">Estimate </span>
          {formatMinutes(estimate)}
        </PencilChip>
      </span>
    </li>
  );
};

const keptWords = (id: NoteVerb) => NOTE_VERBS.find((candidate) => candidate.id === id)?.kept ?? "Kept";

const dimmed = (lit: boolean) => cn("transition-opacity duration-(--dur-base) ease-out", lit && "opacity-35");

const NoteAsk = () => {
  const root = useRef<HTMLDivElement>(null);
  const [ask, send] = useAsk(notePlan);
  const [kept, setKept] = useState<NoteVerb[]>([]);
  const [replaced, setReplaced] = useState(false);
  const [here, setHere] = useState(true);
  const lit = ask.phase !== "idle";
  const verb = askVerb(ask);
  const shown = askShown(ask);
  const open = (via: "keys" | "pointer") => {
    setHere(true);
    send({ type: "open", via });
  };
  useCmdJTarget(root, () => open("keys"));

  const visible = (id: NoteVerb) => kept.includes(id) || verb === id;
  const pencil = (id: NoteVerb) => !kept.includes(id);
  const count = (id: NoteVerb) => (kept.includes(id) ? notePlan(id).total : verb === id ? shown : 0);
  const verbs = NOTE_VERBS.filter((candidate) => !kept.includes(candidate.id) && !(replaced && candidate.id === "link"));

  const close = () => {
    send({ type: "close" });
    root.current?.focus({ preventScroll: true });
  };
  const keep = (id: NoteVerb, words: string, replace: boolean) => {
    const before = { kept, replaced };
    setKept([...kept, id]);
    setReplaced(replaced || replace);
    close();
    showUndo(
      words,
      () => {
        setKept(before.kept);
        setReplaced(before.replaced);
      },
      "ai-note",
    );
  };
  const striking = verb === "tidy" && !kept.includes("tidy");
  const linkState = (index: number) => (!visible("link") || linkOrder(index) >= count("link") ? "off" : pencil("link") ? "pencil" : "ink");
  const tail = visible("continue") && (
    <Ink pencil={pencil("continue")} say>
      {" "}
      <StreamWords text={NOTE_DRAFTS.continue} shown={count("continue")} />
    </Ink>
  );

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="group"
      aria-label="A note with LifeOS AI"
      className={cn("w-full max-w-[35rem] self-center outline-none select-text", AI_RING, NOTE_TYPE.reading.body)}
    >
      <div className="flex h-8 items-center gap-2 text-small text-muted-foreground">
        <AreaDot colour="violet" />
        <span className={cn("min-w-0 flex-1 truncate", dimmed(lit))}>{MEETING.place.join(" › ")}</span>
        {kept.length > 0 && !lit && (
          <Button
            variant="quiet"
            icon={ArrowCounterClockwise}
            iconWeight="bold"
            onClick={() => {
              setKept([]);
              setReplaced(false);
            }}
            className="h-7 px-2.5"
          >
            Start over
          </Button>
        )}
        <Button variant="secondary" icon={AiMark} iconWeight="bold" disabled={lit || verbs.length === 0} onClick={() => open("pointer")} className="h-7 gap-2 pr-1.5 pl-2.5">
          Ask
          <KeyCombo keys="mod+j" />
        </Button>
      </div>
      <h3 className={cn("mt-5", NOTE_TYPE.reading.title, dimmed(lit))}>{MEETING.title}</h3>
      <p className={cn("mt-4 text-pretty", dimmed(lit))}>{MEETING.opening}</p>

      <div className="relative mt-4" data-lit={lit ? "" : undefined} onPointerDown={() => setHere(true)}>
        <MarginBar tone={lit ? "lit" : here ? "here" : "off"} />
        <Fold open={!replaced}>
          <p
            className={cn(
              "-mx-2 rounded-lg px-2 text-pretty transition-[background-color,color,text-decoration-color] duration-(--dur-base) ease-out",
              lit && "bg-foreground/[0.045]",
              striking ? "text-foreground/45 line-through decoration-foreground/25" : "decoration-transparent",
            )}
          >
            {MEETING.rough.map((part, index) =>
              typeof part === "string" ? (
                <span key={index}>{part}</span>
              ) : (
                <LinkMark key={index} state={linkState(index)} note={part.note}>
                  {part.text}
                </LinkMark>
              ),
            )}
            {!replaced && tail}
            {here && !lit && kept.length === 0 && <Caret />}
          </p>
        </Fold>
        {visible("tidy") && (
          <p className={cn("text-pretty", !replaced && "mt-2")}>
            <Ink pencil={pencil("tidy")} say>
              <StreamWords text={NOTE_DRAFTS.tidy} shown={count("tidy")} />
            </Ink>
            {replaced && tail}
          </p>
        )}
        {visible("summarise") && (
          <p className="mt-2 text-pretty">
            <Ink pencil={pencil("summarise")} say>
              <StreamWords text={NOTE_DRAFTS.summarise} shown={count("summarise")} />
            </Ink>
          </p>
        )}
        {visible("tasks") && (
          <ul aria-label="Tasks from this paragraph" className="mt-3 space-y-1">
            {NOTE_TASKS.slice(0, count("tasks")).map((task) => (
              <TaskLine key={task.id} title={task.title} estimate={task.estimate} pencil={pencil("tasks")} />
            ))}
          </ul>
        )}
        {lit && (
          <div className="absolute top-full left-0 z-20 -mx-2 mt-2.5 w-[calc(100%+1rem)]">
            <AskBox
              ask={ask}
              verbs={verbs}
              free="tidy"
              reads={NOTE_READS}
              scope="Reads this paragraph and the notes it links to"
              send={send}
              onKeep={(id) => keep(id, keptWords(id), id === "tidy")}
              onDiscard={close}
              also={{ verb: "tidy", label: "Insert below", run: () => keep("tidy", "Tidy version added below", false) }}
            />
          </div>
        )}
      </div>

      <div className={dimmed(lit)}>
        <h4 className={cn("mt-8", NOTE_TYPE.reading.headings[2])}>{MEETING.heading}</h4>
        <p className="mt-2 text-pretty">{MEETING.closing}</p>
      </div>
    </div>
  );
};

type InkMode = "pencil" | "ink";

const InkRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 @max-xs:grid-cols-1 @max-xs:gap-1">
    <span className="text-small leading-[1.625rem] text-muted-foreground @max-xs:leading-5">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const TwoInks = ({ mode }: { mode: InkMode }) => {
  const pencil = mode === "pencil";
  return (
    <div className={cn("w-full max-w-[27rem] space-y-4 self-center", NOTE_TYPE.reading.body)}>
      <InkRow label="Words">
        <p className="text-pretty">
          <Ink pencil={pencil}>{NOTE_DRAFTS.summarise}</Ink>
        </p>
      </InkRow>
      <InkRow label="A Task">
        <ul>
          <TaskLine key={mode} title={NOTE_TASKS[1].title} estimate={NOTE_TASKS[1].estimate} pencil={pencil} />
        </ul>
      </InkRow>
      <InkRow label="A link">
        <p>
          before the{" "}
          <LinkMark state={mode} note="outline">
            outline
          </LinkMark>{" "}
          goes out
        </p>
      </InkRow>
      <InkRow label="A Work Block">
        <span
          data-ink={mode}
          className="inline-flex h-7 max-w-full items-center gap-2 rounded-md border pr-2 pl-1 text-small whitespace-nowrap transition-[background-color,border-color] duration-(--dur-slow) ease-out"
          style={
            pencil
              ? { borderStyle: "dashed", borderColor: `color-mix(in oklab, ${areaVar("violet")} 70%, transparent)`, backgroundColor: `color-mix(in oklab, ${areaVar("violet")} 6%, transparent)` }
              : { borderColor: "transparent", backgroundColor: `color-mix(in oklab, ${areaVar("violet")} 16%, transparent)` }
          }
        >
          <span aria-hidden="true" className={cn("h-4 w-[3px] rounded-full transition-opacity duration-(--dur-slow)", pencil && "opacity-0")} style={{ backgroundColor: areaVar("violet") }} />
          <Ink pencil={pencil}>Thu</Ink>
          <Ink pencil={pencil} className="font-mono">
            2:30 – 4:00 pm
          </Ink>
        </span>
      </InkRow>
      <InkRow label="An Estimate">
        <span className="flex flex-wrap gap-1.5">
          <PencilChip pencil={false}>0:10</PencilChip>
          <span className="relative">
            <PencilChip pencil={pencil} className={cn(!pencil && "bg-brand text-brand-foreground")}>
              0:15
            </PencilChip>
            <AiMark weight="bold" aria-hidden="true" className={cn("pointer-events-none absolute -top-1 -right-1 size-2.5 text-muted-foreground transition-opacity duration-(--dur-slow)", !pencil && "opacity-0")} />
          </span>
          <PencilChip pencil={false}>0:30</PencilChip>
        </span>
      </InkRow>
    </div>
  );
};

const noop = () => {};

const BOX_MOMENTS: { name: string; note: string; ask: Ask<NoteVerb>; offline?: boolean }[] = [
  { name: "Ask", note: "Opens at once from the keyboard. What the index found shows beside a row when it arrives.", ask: { phase: "asking", via: "keys", query: "", at: 0 } },
  { name: "Offline", note: "It still opens at once, and says so in plain words. Nothing spins and nothing is lost.", ask: { phase: "asking", via: "keys", query: "", at: 0 }, offline: true },
  { name: "Writing", note: "The box shrinks to one line. Esc stops it and keeps what is there.", ask: { phase: "writing", verb: "tidy", shown: 12, total: 40 } },
  { name: "Draft ready", note: "Keep is named for what it does. The line under it asks for a change.", ask: { phase: "proposed", verb: "tidy", shown: 40 } },
];

const BoxMoments = () => (
  <div className="grid w-full items-start gap-x-4 gap-y-6 self-start @2xl:grid-cols-2 @6xl:grid-cols-[1fr_1fr_0.8fr_1.4fr]">
    {BOX_MOMENTS.map((moment) => (
      <figure key={moment.name} className="min-w-0">
        <AskBox
          still
          ask={moment.ask}
          verbs={NOTE_VERBS}
          free="tidy"
          reads={NOTE_READS}
          scope="Reads this paragraph"
          send={noop}
          onKeep={noop}
          onDiscard={noop}
          also={{ verb: "tidy", label: "Insert below", run: noop }}
          {...(moment.offline ? { offline: true } : {})}
          className="max-w-none"
        />
        <figcaption className="mt-3 px-1.5">
          <span className="block text-small font-medium">{moment.name}</span>
          <span className="block text-small text-pretty text-muted-foreground">{moment.note}</span>
        </figcaption>
      </figure>
    ))}
  </div>
);

const KeepTyping = () => (
  <div className={cn("w-full max-w-[27rem] self-center", NOTE_TYPE.reading.body)}>
    <p className="text-pretty text-foreground/45">{MEETING.opening}</p>
    <div className="relative mt-4">
      <MarginBar tone="pencil" />
      <p className="text-pretty">
        <Ink pencil>{NOTE_DRAFTS.summarise}</Ink>
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <AiMark weight="bold" className="size-3.5" aria-hidden="true" />
          Draft
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyCombo keys="mod+enter" />
          Keep
        </span>
        <span className="inline-flex items-center gap-1.5">
          <KeyCombo keys="mod+backspace" />
          Discard
        </span>
      </p>
    </div>
    <div className="relative mt-4">
      <MarginBar tone="here" />
      <p className="text-pretty">
        The small-index run is planned for tonight
        <Caret />
      </p>
    </div>
  </div>
);

export const NoteSpecimens = () => {
  const [mode, setMode] = useState<InkMode>("pencil");
  return (
    <>
      <Specimen
        name="On the line you are on"
        note="Click Ask, or press Cmd+J anywhere on this page. The rest of the page steps back, the draft is written under the line in pencil, and Keep is one undo."
        className="md:col-span-6 xl:col-span-7 xl:row-span-2"
        stage="min-h-[37rem] items-stretch justify-start px-7 sm:px-10"
      >
        <NoteAsk />
      </Specimen>
      <Specimen
        name="Pencil, then ink"
        note="Everything the AI suggests is pencil: grey words, dashed edges. Nothing is saved until you keep it. Then it turns to ink, and it is yours."
        className="md:col-span-6 xl:col-span-5"
        stage="items-stretch justify-center"
        aside={
          <Segmented
            label="Ink"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "pencil", label: "Pencil" },
              { value: "ink", label: "Ink" },
            ]}
          />
        }
      >
        <TwoInks mode={mode} />
      </Specimen>
      <Specimen
        name="Keep typing"
        note="Move the caret and the box folds into one line under the draft. The draft waits in pencil. It never takes the keyboard from you."
        className="md:col-span-6 xl:col-span-5"
        stage="items-stretch justify-center px-8 sm:px-9"
      >
        <KeepTyping />
      </Specimen>
      <Specimen
        name="The box"
        note="One box, four moments. It sits under the line and never over it, and it has no title, no avatar and no history."
        className="md:col-span-6 xl:col-span-12"
        stage="items-stretch justify-start bg-surface p-4 sm:p-5"
      >
        <BoxMoments />
      </Specimen>
    </>
  );
};

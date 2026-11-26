"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/action-button";
import { Specimen } from "../specimen";
import { Decision, Gate, GraphView, Plan, Receipt, Thinking } from "./agent";
import { GATE_START, gateReducer, RUN_START, RUN_TICKS, type GateEvent, type GateState, type Graph } from "./model";
import { Sources } from "./parts";
import { GATE, LOAD_NOW, PROGRESS, RUN_AT, RUN_CHANGES, RUN_FINDING, RUN_OPTIONS, RUN_READ, runSteps, THURSDAY, THURSDAY_AFTER } from "./sample";

const Again = ({ label, onPress }: { label: string; onPress: () => void }) => <IconButton icon={ArrowCounterClockwise} iconWeight="bold" label={label} onClick={onPress} />;

const useBeat = (from: number, to: number, ms: number) => {
  const [beat, setBeat] = useState(to);
  const moving = beat < to;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setBeat((current) => Math.min(to, current + 1)), ms);
    return () => clearInterval(timer);
  }, [moving, to, ms]);
  return [beat, () => setBeat(from)] as const;
};

const ThinkingDemo = () => {
  const [beat, replay] = useBeat(1, RUN_READ.length - 1, 620);
  return (
    <Specimen
      name="Thinking"
      note="Two strokes pulse and a dot joins the row for each thing it reads, in that Area’s colour. No spinner, no shimmer, no typing dots."
      className="md:col-span-3 xl:col-span-4"
      aside={<Again label="Play thinking again" onPress={replay} />}
    >
      <Thinking part={{ kind: "thinking", words: beat < 2 ? "Reading Thursday" : beat < 4 ? "Reading your week" : "Reading your notes", read: RUN_READ.slice(0, beat), of: RUN_READ.length }} />
    </Specimen>
  );
};

const PlanDemo = () => {
  const [beat, replay] = useBeat(RUN_TICKS.plan, RUN_TICKS.decide, 780);
  return (
    <Specimen
      name="A plan that ticks off"
      note="The steps it will take, written before it starts. A loop shows as dots filling. A step that needs you turns blue and waits. It never guesses for you."
      className="md:col-span-3 xl:col-span-4"
      stage="items-stretch justify-center"
      aside={<Again label="Play the plan again" onPress={replay} />}
    >
      <div className="w-full max-w-[19rem] self-center">
        <Plan part={{ kind: "plan", steps: runSteps({ ...RUN_START, tick: beat }) }} />
      </div>
    </Specimen>
  );
};

const SourcesDemo = () => (
  <Specimen
    name="What it looked at"
    note="Every answer carries its sources: notes, Tasks, days and anything from memory. Each chip opens the thing itself."
    className="md:col-span-6 xl:col-span-4"
    stage="items-stretch justify-center"
  >
    <div className="w-full max-w-[21rem] space-y-3 self-center">
      <p className="text-small text-pretty">{RUN_FINDING}</p>
      <Sources sources={RUN_READ} startOpen />
    </div>
  </Specimen>
);

const DecisionDemo = () => {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  return (
    <Specimen
      name="A decision"
      note="When there are two honest ways to go, it stops and shows both, with what each does to your days. Hollow dots are time it would add. Press one. With the keyboard on it, 1 and 2 pick."
      className="md:col-span-6 xl:col-span-7"
      stage="items-stretch justify-center"
      aside={<Again label="Ask again" onPress={() => setChosen(undefined)} />}
    >
      <div className="w-full max-w-[40rem] self-center">
        <Decision part={{ kind: "decision", ask: "Two ways to make room", options: RUN_OPTIONS, advised: "move", chosen }} onChoose={setChosen} />
      </div>
    </Specimen>
  );
};

const GRAPHS: { name: string; graph: Graph }[] = [
  { name: "Time", graph: { kind: "time", day: THURSDAY.day, from: THURSDAY.from, to: THURSDAY.to, spans: THURSDAY_AFTER } },
  { name: "Capacity", graph: { kind: "capacity", days: LOAD_NOW } },
  { name: "Progress", graph: { kind: "progress", ...PROGRESS } },
];

const GraphRow = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 @max-xs:grid-cols-1 @max-xs:gap-1.5">
    <span className="text-small text-muted-foreground">{name}</span>
    <div className="@container min-w-0">{children}</div>
  </div>
);

const GraphsDemo = () => (
  <Specimen
    name="Small graphs"
    note="Time as blocks on a day, capacity as dots against the goal, progress as dots done. Solid is real. Hollow or dashed is a suggestion."
    className="md:col-span-6 xl:col-span-5"
    stage="items-stretch justify-center"
  >
    <div className="w-full max-w-[26rem] space-y-6 self-center">
      {GRAPHS.map((entry) => (
        <GraphRow key={entry.name} name={entry.name}>
          <GraphView graph={entry.graph} />
        </GraphRow>
      ))}
    </div>
  </Specimen>
);

const GateBody = () => {
  const holder = useRef<HTMLDivElement>(null);
  const [gate, send] = useReducer(gateReducer, GATE_START);
  const [declined, setDeclined] = useState(false);
  const settle = (act: () => void) => {
    act();
    holder.current?.focus({ preventScroll: true });
  };
  return (
    <div ref={holder} tabIndex={-1} className="outline-none">
      <GateView gate={gate} send={send} declined={declined} onMake={() => settle(() => send({ type: "make" }))} onDecline={() => settle(() => setDeclined(true))} />
    </div>
  );
};

const GateView = ({ gate, send, declined, onMake, onDecline }: { gate: GateState; send: (event: GateEvent) => void; declined: boolean; onMake: () => void; onDecline: () => void }) => {
  if (declined)
    return (
      <p role="status" className="rounded-xl bg-foreground/[0.04] p-3 text-small text-pretty text-muted-foreground">
        Left alone. The run carried on with everything else and said so in its receipt.
      </p>
    );
  return gate.made ? (
    <Receipt
      part={{ kind: "receipt", at: RUN_AT, changes: GATE.changes.filter((change) => !gate.skipped.includes(change.id)), undone: gate.undone }}
      onUndo={(change) => send({ type: "undo", change })}
      onUndoAll={(changes) => send({ type: "undo-all", changes })}
      onRedoAll={() => send({ type: "redo-all" })}
    />
  ) : (
    <Gate
      part={{ kind: "gate", why: GATE.why, go: GATE.go, changes: GATE.changes, skipped: gate.skipped }}
      onSkip={(change) => send({ type: "skip", change })}
      onMake={onMake}
      onDecline={onDecline}
    />
  );
};

const GateDemo = () => {
  const [round, setRound] = useState(0);
  return (
    <Specimen
      name="Asking first"
      note="A run makes changes by itself when one undo takes them back. For the Trash, a Task becoming a Project, more than 10 changes, or anything that cannot be undone, it stops and shows this."
      className="md:col-span-6 xl:col-span-6"
      stage="items-stretch justify-center"
      aside={<Again label="Show the question again" onPress={() => setRound(round + 1)} />}
    >
      <div className="w-full max-w-[34rem] self-center">
        <GateBody key={round} />
      </div>
    </Specimen>
  );
};

const CHANGES = RUN_CHANGES.move ?? [];
const MADE: GateState = { ...GATE_START, made: true };

const ReceiptDemo = () => {
  const [gate, send] = useReducer(gateReducer, MADE);
  return (
    <Specimen
      name="The receipt"
      note="What a run did, in ink, the moment it did it. Undo one change or all of them, now or next week. Cmd+Z takes the whole run back in one step."
      className="md:col-span-6 xl:col-span-6"
      stage="items-stretch justify-center"
    >
      <div className="w-full max-w-[34rem] self-center">
        <Receipt
          part={{ kind: "receipt", at: RUN_AT, changes: CHANGES, undone: gate.undone }}
          onUndo={(change) => send({ type: "undo", change })}
          onUndoAll={(changes) => send({ type: "undo-all", changes })}
          onRedoAll={() => send({ type: "redo-all" })}
        />
      </div>
    </Specimen>
  );
};

export const AgentSpecimens = () => (
  <>
    <ThinkingDemo />
    <PlanDemo />
    <SourcesDemo />
    <DecisionDemo />
    <GraphsDemo />
    <GateDemo />
    <ReceiptDemo />
  </>
);

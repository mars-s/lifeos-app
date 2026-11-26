import type { Icon } from "@phosphor-icons/react";
import type { AreaColour } from "@/components/lifeos/area";
import type { MeterSlice } from "@/components/lifeos/capacity";
import type { NoteId, TaskId } from "../notes/model";

export type Via = "keys" | "pointer";

export type Verb<Id extends string> = {
  id: Id;
  label: string;
  icon: Icon;
  found?: string;
  keep: string;
  kept: string;
  reading: string;
};

export type Ask<Id extends string> =
  | { phase: "idle" }
  | { phase: "asking"; via: Via; query: string; at: number }
  | { phase: "reading"; verb: Id }
  | { phase: "writing"; verb: Id; shown: number; total: number }
  | { phase: "proposed"; verb: Id; shown: number };

export type AskEvent<Id extends string> =
  | { type: "open"; via: Via }
  | { type: "type"; query: string }
  | { type: "move"; to: number }
  | { type: "pick"; verb: Id }
  | { type: "start"; total: number }
  | { type: "tick" }
  | { type: "stop" }
  | { type: "close" };

export const askReducer = <Id extends string>(state: Ask<Id>, event: AskEvent<Id>) => {
  if (event.type === "close") return { phase: "idle" } satisfies Ask<Id>;
  if (event.type === "open") return state.phase === "idle" ? ({ phase: "asking", via: event.via, query: "", at: 0 } satisfies Ask<Id>) : state;
  if (event.type === "pick") return state.phase === "asking" || state.phase === "proposed" ? ({ phase: "reading", verb: event.verb } satisfies Ask<Id>) : state;
  if (state.phase === "asking") {
    if (event.type === "type") return { ...state, query: event.query, at: 0 } satisfies Ask<Id>;
    if (event.type === "move") return { ...state, at: event.to } satisfies Ask<Id>;
    return state;
  }
  if (state.phase === "reading") {
    if (event.type === "start") return { phase: "writing", verb: state.verb, shown: 0, total: event.total } satisfies Ask<Id>;
    if (event.type === "stop") return { phase: "asking", via: "keys", query: "", at: 0 } satisfies Ask<Id>;
    return state;
  }
  if (state.phase === "writing") {
    if (event.type === "stop") return { phase: "proposed", verb: state.verb, shown: state.shown } satisfies Ask<Id>;
    if (event.type === "tick") {
      const shown = state.shown + 1;
      return shown >= state.total ? ({ phase: "proposed", verb: state.verb, shown: state.total } satisfies Ask<Id>) : ({ ...state, shown } satisfies Ask<Id>);
    }
  }
  return state;
};

export const askVerb = <Id extends string>(ask: Ask<Id>) => (ask.phase === "reading" || ask.phase === "writing" || ask.phase === "proposed" ? ask.verb : undefined);

export const askShown = <Id extends string>(ask: Ask<Id>) => (ask.phase === "writing" || ask.phase === "proposed" ? ask.shown : 0);

export const matchVerbs = <Id extends string>(verbs: readonly Verb<Id>[], query: string) => {
  const needle = query.trim().toLowerCase();
  return needle ? verbs.filter((verb) => verb.label.toLowerCase().includes(needle)) : verbs;
};

export type MemoryId = string;

export type SourceRef =
  | { kind: "note"; id: NoteId }
  | { kind: "task"; id: TaskId }
  | { kind: "day"; label: string }
  | { kind: "memory"; id: MemoryId };

export const sourceKey = (ref: SourceRef) => `${ref.kind}-${ref.kind === "day" ? ref.label : ref.id}`;

export type StepState = "todo" | "doing" | "done" | "waiting";

export type PlanStep = { id: string; title: string; state: StepState; loop?: { done: number; of: number; unit: string } };

export type ChangeVerb = "plan" | "move" | "link" | "trash";

export type Change = { id: string; verb: ChangeVerb; subject: string; colour: AreaColour; from?: string; to: string };

export type DaySpan = { id: string; title: string; start: number; minutes: number; kind: "commitment" | "block" | "pencil"; colour?: AreaColour };

export type LoadDay = { label: string; goal: number; free: number; slices: MeterSlice[] };

export type Graph =
  | { kind: "time"; day: string; from: number; to: number; spans: DaySpan[] }
  | { kind: "capacity"; days: LoadDay[] }
  | { kind: "progress"; title: string; colour: AreaColour; done: number; pencil: number; total: number };

export type Option = { id: string; title: string; detail: string; days: LoadDay[]; because?: SourceRef };

export type Part =
  | { kind: "thinking"; words: string; read: SourceRef[]; of: number }
  | { kind: "plan"; steps: PlanStep[] }
  | { kind: "words"; text: string }
  | { kind: "graph"; graph: Graph }
  | { kind: "decision"; ask: string; options: Option[]; advised: string; chosen: string | undefined }
  | { kind: "gate"; why: string; go: string; changes: Change[]; skipped: string[] }
  | { kind: "receipt"; at: string; changes: Change[]; undone: string[] }
  | { kind: "remembered"; text: string; undone: boolean }
  | { kind: "sources"; refs: SourceRef[] };

export type RunStatus = "working" | "needs-you" | "done" | "offline" | "failed";

export type RunState = { tick: number; choice: string | undefined; undone: string[]; unlearnt: boolean };

export type RunEvent =
  | { type: "tick" }
  | { type: "choose"; option: string }
  | { type: "undo"; change: string }
  | { type: "undo-all"; changes: string[] }
  | { type: "redo-all" }
  | { type: "unlearn" }
  | { type: "reset" };

export const RUN_START: RunState = { tick: 0, choice: undefined, undone: [], unlearnt: false };

export const RUN_TICKS = { plan: 4, loop: 5, decide: 9, act: 10, check: 11, done: 12 } as const;

export const runActed = (state: RunState) => state.tick >= RUN_TICKS.check;

export const runWaits = (state: RunState) => (state.tick === RUN_TICKS.decide && state.choice === undefined) || state.tick >= RUN_TICKS.done;

const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

export const runReducer = (state: RunState, event: RunEvent) => {
  if (event.type === "reset") return RUN_START;
  if (event.type === "tick") return runWaits(state) ? state : { ...state, tick: state.tick + 1 };
  if (event.type === "choose") return state.tick === RUN_TICKS.decide ? { ...state, choice: event.option, tick: state.tick + 1 } : state;
  if (!runActed(state)) return state;
  if (event.type === "undo") return { ...state, undone: toggled(state.undone, event.change) };
  if (event.type === "undo-all") return { ...state, undone: event.changes };
  if (event.type === "unlearn") return { ...state, unlearnt: !state.unlearnt };
  return { ...state, undone: [] };
};

export const runStatus = (state: RunState) => {
  if (state.tick >= RUN_TICKS.done) return "done" satisfies RunStatus;
  return runWaits(state) ? ("needs-you" satisfies RunStatus) : ("working" satisfies RunStatus);
};

export type GateState = { skipped: string[]; made: boolean; undone: string[] };

export type GateEvent = { type: "skip"; change: string } | { type: "make" } | { type: "undo"; change: string } | { type: "undo-all"; changes: string[] } | { type: "redo-all" };

export const GATE_START: GateState = { skipped: [], made: false, undone: [] };

export const gateReducer = (state: GateState, event: GateEvent) => {
  if (event.type === "skip") return state.made ? state : { ...state, skipped: toggled(state.skipped, event.change) };
  if (event.type === "make") return { ...state, made: true };
  if (!state.made) return state;
  if (event.type === "undo") return { ...state, undone: toggled(state.undone, event.change) };
  if (event.type === "undo-all") return { ...state, undone: event.changes };
  return { ...state, undone: [] };
};

export type MemoryGroup = "you" | "work" | "people";

export type Memory = { id: MemoryId; group: MemoryGroup; text: string; from: string; used: number; pinned: boolean; fresh: boolean };

export type IndexRow = { id: string; label: string; detail: string; indexed: number; total: number };

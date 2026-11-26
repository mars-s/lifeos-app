import { ArrowBendDownRight, Broom, CalendarPlus, EnvelopeSimple, LinkSimple, ListBullets, ListChecks, Notebook, TextAlignLeft, Timer } from "@phosphor-icons/react";
import type { MeterSlice } from "@/components/lifeos/capacity";
import type { NoteId } from "../notes/model";
import { RUN_TICKS, runActed, type Change, type DaySpan, type IndexRow, type LoadDay, type Memory, type MemoryGroup, type Option, type Part, type PlanStep, type RunState, type SourceRef, type Verb } from "./model";

export const MODEL = "DeepSeek V4.1 Flash";

export const NOTE_VERB_IDS = ["tasks", "link", "summarise", "tidy", "continue"] as const;
export type NoteVerb = (typeof NOTE_VERB_IDS)[number];

export const NOTE_VERBS: Verb<NoteVerb>[] = [
  { id: "tasks", label: "Turn into Tasks", icon: ListChecks, keep: "Add 3 Tasks", kept: "3 Tasks added to Honours thesis", reading: "Reading this paragraph" },
  { id: "link", label: "Link related notes", icon: LinkSimple, found: "3 found", keep: "Link 3 notes", kept: "Linked 3 notes", reading: "Looking through 213 notes" },
  { id: "summarise", label: "Summarise", icon: TextAlignLeft, keep: "Insert", kept: "Summary added", reading: "Reading this paragraph" },
  { id: "tidy", label: "Tidy", icon: Broom, keep: "Replace", kept: "Tidied 1 paragraph", reading: "Reading this paragraph" },
  { id: "continue", label: "Continue", icon: ArrowBendDownRight, keep: "Keep", kept: "Kept 1 sentence", reading: "Reading the note and the outline" },
];

export type RoughPart = string | { text: string; note: NoteId };

export const MEETING = {
  title: "Supervision, 17 Nov",
  place: ["University", "Honours thesis"],
  opening: "Dr Nguyen read the retrieval notes on the train. Half an hour, mostly about chapter 3.",
  rough: [
    "she wants the small index run done before the ",
    { text: "outline", note: "outline" },
    " goes out. liked the ",
    { text: "hybrid table", note: "retrieval" },
    " but says recall alone wont convince anyone, put mrr beside it like in the ",
    { text: "eval plan", note: "evaluation" },
    ". email her the new table. still need one figure for related work",
  ] satisfies RoughPart[],
  heading: "Before next week",
  closing: "The outline is due Sunday. She is away the week after, so anything I want read has to reach her by then.",
};

export const NOTE_DRAFTS = {
  tidy: "She wants the small-index run done before the outline goes out. She liked the hybrid table, but recall alone will not convince anyone, so MRR goes beside it. I still owe her the new table and one figure for related work.",
  summarise: "In short: run the small index first, put MRR beside recall, then send the outline.",
  continue: "So the order is the small-index run tonight, the new table tomorrow morning, and the outline on Sunday with both in it.",
} as const satisfies Partial<Record<NoteVerb, string>>;

export const NOTE_TASKS = [
  { id: "small-index", title: "Rerun the hybrid on the small index", estimate: 90 },
  { id: "email-table", title: "Email Dr Nguyen the new table", estimate: 15 },
  { id: "figure", title: "Find one figure for related work", estimate: 45 },
] as const;

export const NOTE_READS: Record<NoteVerb, SourceRef[]> = {
  tasks: [{ kind: "note", id: "supervision" }, { kind: "task", id: "rerun" }],
  link: [{ kind: "note", id: "outline" }, { kind: "note", id: "retrieval" }, { kind: "note", id: "evaluation" }],
  summarise: [{ kind: "note", id: "supervision" }],
  tidy: [{ kind: "note", id: "supervision" }, { kind: "memory", id: "plain" }],
  continue: [{ kind: "note", id: "supervision" }, { kind: "note", id: "outline" }, { kind: "memory", id: "plain" }],
};

export const TASK_VERB_IDS = ["steps", "estimate", "time", "related", "email"] as const;
export type TaskVerb = (typeof TASK_VERB_IDS)[number];

export const TASK_VERBS: Verb<TaskVerb>[] = [
  { id: "steps", label: "Break into steps", icon: ListBullets, keep: "Add 3 steps", kept: "Added 3 steps", reading: "Reading the Task" },
  { id: "estimate", label: "Estimate", icon: Timer, found: "0:15", keep: "Set 0:15", kept: "Estimate set to 0:15", reading: "Comparing 41 finished Tasks" },
  { id: "time", label: "Find a time", icon: CalendarPlus, found: "Thu 1:30 pm", keep: "Plan it", kept: "Planned for Thu 1:30 pm", reading: "Reading Thursday" },
  { id: "related", label: "Find related notes", icon: Notebook, found: "3 found", keep: "Link 3 notes", kept: "Linked 3 notes", reading: "Looking through 213 notes" },
  { id: "email", label: "Draft the email", icon: EnvelopeSimple, keep: "Keep in Notes", kept: "Draft kept in Notes", reading: "Reading the Task and Supervision, 17 Nov" },
];

export const ASK_TASK = {
  title: "Email Dr Nguyen the new table",
  project: "Honours thesis",
  deadline: "Sun 22 Nov",
};

export const TASK_STEPS = ["Export the table with the MRR column", "Write two lines on what changed", "Send it and ask about the outline"] as const;

export const TASK_ESTIMATE = {
  minutes: 15,
  why: "Like “Reply to Harry about the October invoice”, which took 0:12. You usually run 33% over, so not 0:10.",
};

export const TASK_EMAIL =
  "Hi Dr Nguyen, the table from Tuesday is attached, now with MRR beside recall@10. The hybrid still leads on both. The small-index run is planned for Thursday morning, and the outline will reach you on Sunday. Avi";

export const TASK_NOTES: NoteId[] = ["supervision", "retrieval", "evaluation"];

export const TASK_READS: Record<TaskVerb, SourceRef[]> = {
  steps: [{ kind: "note", id: "supervision" }],
  estimate: [{ kind: "memory", id: "over" }],
  time: [{ kind: "day", label: "Thu 19 Nov" }, { kind: "memory", id: "evening" }],
  related: [{ kind: "note", id: "supervision" }, { kind: "note", id: "retrieval" }, { kind: "note", id: "evaluation" }],
  email: [{ kind: "note", id: "supervision" }, { kind: "note", id: "retrieval" }, { kind: "memory", id: "plain" }],
};

const span = (id: string, title: string, start: number, minutes: number, kind: DaySpan["kind"], colour?: DaySpan["colour"]) =>
  (colour ? { id, title, start, minutes, kind, colour } : { id, title, start, minutes, kind }) satisfies DaySpan;

const THURSDAY_FIXED: DaySpan[] = [
  span("lecture", "COMP3900 lecture", 9 * 60, 120, "commitment"),
  span("rerun", "Rerun the hybrid on the small index", 11 * 60 + 15, 90, "block", "violet"),
  span("copy", "Review the onboarding copy", 13 * 60 + 45, 45, "block", "teal"),
  span("invoice", "Reply to Harry about the October invoice", 16 * 60, 60, "block", "orange"),
  span("sds", "Check the SDS import", 17 * 60, 45, "block", "rose"),
];

export const THURSDAY = { day: "Thu 19 Nov", from: 8 * 60, to: 18 * 60 } as const;

export const TASK_TIME = {
  spans: [...THURSDAY_FIXED, span("reading", "Read two papers on retrieval", 14 * 60 + 30, 60, "block", "violet"), span("email", ASK_TASK.title, 13 * 60 + 30, 15, "pencil", "violet")],
  start: 13 * 60 + 30,
  minutes: 15,
  why: "Straight after lunch, before the onboarding copy. Your evenings stay free.",
  others: ["11:00 am", "3:30 pm"],
};

const slice = (id: string, colour: MeterSlice["colour"], minutes: number, guess = false) => ({ id, colour, minutes, guess }) satisfies MeterSlice;

const THU_REST = [slice("rerun", "violet", 90), slice("copy", "teal", 45), slice("invoice", "orange", 60), slice("sds", "rose", 45)];
const FRI_REST = [slice("tutorial", "violet", 60), slice("ferry", "green", 15), slice("copy-2", "teal", 105)];
const GOAL = 6 * 60;

export const LOAD_NOW: LoadDay[] = [
  { label: "Thu", goal: GOAL, free: GOAL, slices: [...THU_REST, slice("reading", "violet", 60)] },
  { label: "Fri", goal: GOAL, free: GOAL, slices: FRI_REST },
];

const LOAD_MOVE: LoadDay[] = [
  { label: "Thu", goal: GOAL, free: GOAL, slices: [...THU_REST, slice("outline", "violet", 90, true)] },
  { label: "Fri", goal: GOAL, free: GOAL, slices: [...FRI_REST, slice("reading", "violet", 60, true)] },
];

const LOAD_SPLIT: LoadDay[] = [
  { label: "Thu", goal: GOAL, free: GOAL, slices: [...THU_REST, slice("reading", "violet", 60), slice("outline-a", "violet", 60, true)] },
  { label: "Fri", goal: GOAL, free: GOAL, slices: [...FRI_REST, slice("outline-b", "violet", 30, true)] },
];

export const RUN_ASK = "Make room for the thesis outline";

export const RUN_OPTIONS: Option[] = [
  {
    id: "move",
    title: "Move the reading to Friday",
    detail: "Read two papers on retrieval goes to Fri 10:00 am. The outline takes its place, in one sitting.",
    days: LOAD_MOVE,
    because: { kind: "memory", id: "deep" },
  },
  {
    id: "split",
    title: "Split the outline",
    detail: "1:00 on Thursday before the lecture and 0:30 on Friday morning. Nothing else moves.",
    days: LOAD_SPLIT,
  },
];

export const RUN_CHANGES: Record<string, Change[]> = {
  move: [
    { id: "move-reading", verb: "move", subject: "Read two papers on retrieval", colour: "violet", from: "Thu 2:30 pm", to: "Fri 10:00 am" },
    { id: "plan-outline", verb: "plan", subject: "Draft the thesis outline", colour: "violet", to: "Thu 2:30 – 4:00 pm" },
    { id: "link-notes", verb: "link", subject: "Draft the thesis outline", colour: "violet", to: "Supervision, 17 Nov" },
  ],
  split: [
    { id: "plan-outline-a", verb: "plan", subject: "Draft the thesis outline", colour: "violet", to: "Thu 8:00 – 9:00 am" },
    { id: "plan-outline-b", verb: "plan", subject: "Draft the thesis outline", colour: "violet", to: "Fri 9:00 – 9:30 am" },
    { id: "link-notes", verb: "link", subject: "Draft the thesis outline", colour: "violet", to: "Supervision, 17 Nov" },
  ],
};

export const RUN_READ: SourceRef[] = [
  { kind: "day", label: "Thu 19 Nov" },
  { kind: "day", label: "Fri 20 Nov" },
  { kind: "task", id: "outline-draft" },
  { kind: "note", id: "supervision" },
  { kind: "memory", id: "deep" },
];

const RUN_STEPS = [
  { id: "read", title: "Read Thursday and Friday" },
  { id: "check", title: "Check the next 4 days for room" },
  { id: "choose", title: "Pick how to make room" },
  { id: "act", title: "Make 3 changes" },
  { id: "fit", title: "Check both days still fit" },
] as const;

const DAYS_CHECKED = 4;

const stepState = (index: number, state: RunState) => {
  const { tick } = state;
  const doing = tick < RUN_TICKS.loop ? 0 : tick < RUN_TICKS.decide ? 1 : tick === RUN_TICKS.decide ? 2 : tick === RUN_TICKS.act ? 3 : 4;
  if (tick >= RUN_TICKS.done || index < doing) return "done" satisfies PlanStep["state"];
  if (index > doing) return "todo" satisfies PlanStep["state"];
  return doing === 2 ? ("waiting" satisfies PlanStep["state"]) : ("doing" satisfies PlanStep["state"]);
};

export const runSteps = (state: RunState) =>
  RUN_STEPS.map((step, index) => {
    const base = { id: step.id, title: step.title, state: stepState(index, state) } satisfies PlanStep;
    if (step.id !== "check" || state.tick < RUN_TICKS.loop) return base;
    return { ...base, loop: { done: Math.min(DAYS_CHECKED, state.tick - RUN_TICKS.loop + 1), of: DAYS_CHECKED, unit: "days" } } satisfies PlanStep;
  });

export const RUN_FINDING = "Thursday has 1:00 spare and the outline needs 1:30. Friday has 3:00 spare.";
export const RUN_AT = "Thu 19 Nov, 9:41 am";

export const RUN_LEARNT = "When Thursday is full, you move reading to Friday.";

export const runParts = (state: RunState) => {
  const parts: Part[] = [];
  if (state.tick < RUN_TICKS.plan) return [{ kind: "thinking", words: "Reading your week", read: RUN_READ.slice(0, state.tick + 2), of: RUN_READ.length } satisfies Part];
  parts.push({ kind: "plan", steps: runSteps(state) });
  if (state.tick < RUN_TICKS.decide) return parts;
  parts.push({ kind: "words", text: RUN_FINDING }, { kind: "decision", ask: "Two ways to make room", options: RUN_OPTIONS, advised: "move", chosen: state.choice });
  const changes = state.choice ? RUN_CHANGES[state.choice] : undefined;
  if (!changes || !runActed(state)) return parts;
  parts.push({ kind: "receipt", at: RUN_AT, changes, undone: state.undone });
  if (state.tick < RUN_TICKS.done) return parts;
  if (state.choice === "move") parts.push({ kind: "remembered", text: RUN_LEARNT, undone: state.unlearnt });
  parts.push({ kind: "sources", refs: RUN_READ });
  return parts;
};

export const runMade = (state: RunState) => (state.choice ? (RUN_CHANGES[state.choice]?.length ?? 0) : 0) - state.undone.length;

export const runWords = (state: RunState) => {
  if (state.tick >= RUN_TICKS.done) {
    const made = runMade(state);
    return made === 0 ? "Done. Everything undone" : `Done. ${made} ${made === 1 ? "change" : "changes"}`;
  }
  if (state.tick < RUN_TICKS.plan) return "Reading your week";
  if (state.tick < RUN_TICKS.loop) return "Reading Thursday and Friday";
  if (state.tick < RUN_TICKS.decide) return "Checking the next 4 days";
  if (state.tick === RUN_TICKS.decide) return "Needs you: pick one";
  if (state.tick === RUN_TICKS.act) return "Making 3 changes";
  return "Checking both days still fit";
};

export const THURSDAY_PLAN: DaySpan[] = [...THURSDAY_FIXED, span("reading", "Read two papers on retrieval", 14 * 60 + 30, 60, "block", "violet")];

export const THURSDAY_AFTER: DaySpan[] = [...THURSDAY_FIXED, span("outline", "Draft the thesis outline", 14 * 60 + 30, 90, "pencil", "violet")];

const OUTLINE_AT = { move: { change: "plan-outline", start: 14 * 60 + 30, minutes: 90 }, split: { change: "plan-outline-a", start: 8 * 60, minutes: 60 } } as const;

export const thursdayAt = (state: RunState) => {
  const acted = runActed(state);
  const reading = span("reading", "Read two papers on retrieval", 14 * 60 + 30, 60, "block", "violet");
  const outline = state.choice === "move" || state.choice === "split" ? OUTLINE_AT[state.choice] : undefined;
  const moved = acted && state.choice === "move" && !state.undone.includes("move-reading");
  return [
    ...THURSDAY_FIXED,
    ...(moved ? [] : [reading]),
    ...(acted && outline && !state.undone.includes(outline.change) ? [span("outline", "Draft the thesis outline", outline.start, outline.minutes, "block", "violet")] : []),
  ];
};

export const GATE = {
  why: "It asks first, because the Trash is one of the things it never does alone.",
  go: "Trash",
  changes: [
    { id: "dup-ferry", verb: "trash", subject: "Book ferry", colour: "green", to: "Same as Book the ferry to Naoshima" },
    { id: "dup-papers", verb: "trash", subject: "Read retrieval papers", colour: "violet", to: "Same as Read two papers on retrieval" },
    { id: "dup-physio", verb: "trash", subject: "Physio appt", colour: "green", to: "Same as Book a physio appointment" },
    { id: "old-invoice", verb: "trash", subject: "Chase the September invoice", colour: "orange", to: "Paid on 2 Oct" },
  ] satisfies Change[],
};

export const MEMORY_GROUPS: Record<MemoryGroup, string> = { you: "About you", work: "How you work", people: "People" };

const memoryOf = (id: string, group: MemoryGroup, text: string, from: string, used: number, flags: { pinned?: boolean; fresh?: boolean } = {}) =>
  ({ id, group, text, from, used, pinned: flags.pinned ?? false, fresh: flags.fresh ?? false }) satisfies Memory;

export const MEMORIES: Memory[] = [
  memoryOf("friday", "work", RUN_LEARNT, "From Make room for the thesis outline, today", 0, { fresh: true }),
  memoryOf("sunday", "work", "You type in the notebook pages on Sunday.", "You said so on Sun 22 Nov", 2, { fresh: true }),
  memoryOf("plain", "you", "You write in short, plain sentences, with Australian spelling.", "You said so on 12 Nov", 18, { pinned: true }),
  memoryOf("deep", "work", "Deep Work goes in one sitting, in the morning when there is room.", "You said so on 3 Nov", 12, { pinned: true }),
  memoryOf("honours", "you", "You are doing Honours this year. The thesis is on retrieval.", "You said so on 12 Nov", 31),
  memoryOf("over", "work", "You run about 33% over your Estimates on writing Tasks.", "From 41 finished Tasks", 44),
  memoryOf("evening", "work", "Nothing new gets planned after 6:00 pm.", "You said so on 3 Nov", 9),
  memoryOf("nguyen", "people", "Dr Nguyen is your Honours supervisor. Supervision is on Tuesdays.", "From Supervision, 17 Nov", 15),
  memoryOf("harry", "people", "Harry sends the Paperless invoices at the end of each month.", "From 4 finished Tasks", 3),
];

export const memoryText = (id: string) => MEMORIES.find((memory) => memory.id === id)?.text ?? "";

export const INDEX_ROWS: IndexRow[] = [
  { id: "tasks", label: "Tasks", detail: "Title, notes, Checklist", indexed: 1204, total: 1204 },
  { id: "projects", label: "Projects and Areas", detail: "Name and notes", indexed: 19, total: 19 },
  { id: "notes", label: "Notes", detail: "A snippet of each section", indexed: 1812, total: 1870 },
  { id: "links", label: "Saved Links", detail: "Title and summary", indexed: 96, total: 96 },
  { id: "days", label: "Days", detail: "One summary a day", indexed: 338, total: 338 },
  { id: "memories", label: "Memories", detail: "Each sentence", indexed: 9, total: 9 },
];

export const PROGRESS = { title: "Honours thesis", colour: "violet", done: 12, pencil: 3, total: 30 } as const;

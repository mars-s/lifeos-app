import type { AreaColour } from "@/components/lifeos/area";

export const NOTE_IDS = [
  "retrieval",
  "outline",
  "dense-sparse",
  "supervision",
  "evaluation",
  "japan",
  "copy",
  "pricing",
  "sds",
  "reading-list",
  "day-19",
  "day-18",
  "day-17",
] as const;
export type NoteId = (typeof NOTE_IDS)[number];

export const TASK_IDS = ["papers", "outline-draft", "rerun", "ferry", "copy-review"] as const;
export type TaskId = (typeof TASK_IDS)[number];

export const PROJECT_IDS = ["thesis", "japan-trip", "onboarding"] as const;
export type ProjectId = (typeof PROJECT_IDS)[number];

export const AREA_IDS = ["university", "personal", "paperless", "korvant", "chemwatch"] as const;
export type AreaId = (typeof AREA_IDS)[number];

export type Area = { name: string; colour: AreaColour };
export type Project = { title: string; area: AreaId; progress: number };
export type LinkedTask = { title: string; area: AreaId; project?: ProjectId; when?: string; estimate?: number; done: boolean; notes: NoteId[] };
export type NoteLabel = { name: string; colour: AreaColour };

export type EntityRef =
  | { kind: "task"; id: TaskId }
  | { kind: "project"; id: ProjectId }
  | { kind: "area"; id: AreaId };

export type Inline =
  | string
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "note"; id: NoteId; alias?: string }
  | { kind: "missing"; title: string }
  | { kind: "entity"; ref: EntityRef }
  | { kind: "label"; name: string }
  | { kind: "href"; text: string; href: string };

export type CalloutTone = "note" | "idea" | "question" | "warning";

export type Todo = { id: string; done: boolean; text: Inline[]; task?: TaskId };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "todos"; items: Todo[] }
  | { kind: "quote"; text: Inline[]; cite?: Inline[] }
  | { kind: "code"; language: string; lines: string[] }
  | { kind: "callout"; tone: CalloutTone; title: string; text: Inline[] }
  | { kind: "table"; head: string[]; rows: string[][]; figures: number[] }
  | { kind: "image"; src: string; alt: string; caption: string }
  | { kind: "rule" };

export type NotebookPage = { page: number; lines: string[] };

export type Note = {
  title: string;
  area?: AreaId;
  project?: ProjectId;
  day?: string;
  edited: string;
  pinned?: boolean;
  labels: string[];
  blocks: Block[];
  notebook?: NotebookPage[];
};

export type SyncState =
  | { kind: "synced"; devices: number }
  | { kind: "offline"; waiting: number }
  | { kind: "merging"; edits: number; from: string };

const inlineText = (inline: Inline) => {
  if (typeof inline === "string") return inline;
  if (inline.kind === "note") return inline.alias ?? "";
  if (inline.kind === "missing") return inline.title;
  if (inline.kind === "entity") return "";
  if (inline.kind === "label") return "";
  return inline.text;
};

export const plainText = (inlines: Inline[], titleOf: (id: NoteId) => string) =>
  inlines
    .map((inline) => (typeof inline !== "string" && inline.kind === "note" ? (inline.alias ?? titleOf(inline.id)) : inlineText(inline)))
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();

export const blockInlines = (block: Block) => {
  if (block.kind === "heading" || block.kind === "paragraph") return [block.text];
  if (block.kind === "bullets") return block.items;
  if (block.kind === "todos") return block.items.map((item) => item.text);
  if (block.kind === "quote") return [block.text, block.cite ?? []];
  if (block.kind === "callout") return [block.text];
  return [];
};

export const noteInlines = (note: Note) => note.blocks.flatMap(blockInlines).flat();

export type NoteLinks = { notes: NoteId[]; missing: string[]; entities: EntityRef[] };

export const linksOut = (note: Note) => {
  const inlines = noteInlines(note);
  const links: NoteLinks = { notes: [], missing: [], entities: [] };
  for (const inline of inlines) {
    if (typeof inline === "string") continue;
    if (inline.kind === "note" && !links.notes.includes(inline.id)) links.notes.push(inline.id);
    if (inline.kind === "missing" && !links.missing.includes(inline.title)) links.missing.push(inline.title);
    if (inline.kind === "entity" && !links.entities.some((ref) => ref.kind === inline.ref.kind && ref.id === inline.ref.id)) links.entities.push(inline.ref);
  }
  return links;
};

export type Backlink = { from: NoteId; context: Inline[] };

export const backlinksOf = (target: NoteId, notes: Record<NoteId, Note>) =>
  NOTE_IDS.flatMap((from) => {
    if (from === target) return [];
    const context = notes[from].blocks.flatMap(blockInlines).find((inlines) => inlines.some((inline) => typeof inline !== "string" && inline.kind === "note" && inline.id === target));
    return context ? [{ from, context } satisfies Backlink] : [];
  });

const matchRank = (title: string, needle: string) => {
  const text = title.toLowerCase();
  if (text.startsWith(needle)) return 0;
  if (text.split(/[\s,]+/).some((word) => word.startsWith(needle))) return 1;
  return text.includes(needle) ? 2 : 3;
};

export const bestMatches = <Id extends string>(ids: readonly Id[], titleOf: (id: Id) => string, query: string) => {
  const needle = query.trim().toLowerCase();
  return ids
    .map((id) => ({ id, rank: matchRank(titleOf(id), needle) }))
    .filter((match) => match.rank < 3)
    .toSorted((first, second) => first.rank - second.rank)
    .map((match) => match.id);
};

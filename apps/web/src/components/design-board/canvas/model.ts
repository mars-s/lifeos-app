import type { NoteId, TaskId } from "../notes/model";

export type SocketType = "text" | "number" | "file" | "folder";
export type Socket = { id: string; label: string; type: SocketType };

export type Side = "top" | "right" | "bottom" | "left";

type Box = { id: string; x: number; y: number; w: number; h: number };
type Wired = { inputs: Socket[]; outputs: Socket[] };

export type Runner = "shell" | "claude";

export type NoteCard = Box & { kind: "note"; note: NoteId };
export type TextCard = Box & { kind: "text"; text: string };
export type TaskCard = Box & { kind: "task"; task: TaskId };
export type GroupCard = Box & { kind: "group"; label: string };
export type StepCard = Box & Wired & { kind: "step"; title: string; runner: Runner; command: string; reach: string[] };
export type ViewCard = Box & Wired & { kind: "view"; title: string };
export type BlockCard = Box & Wired & { kind: "block"; title: string };

export type Card = NoteCard | TextCard | TaskCard | GroupCard | StepCard | ViewCard | BlockCard;

export type Edge = {
  id: string;
  from: string;
  to: string;
  fromSocket?: string;
  toSocket?: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
};

export type StepState = "idle" | "waiting" | "running" | "done" | "kept" | "failed";
export type StepStatus = { state: StepState; words: string; done?: number; of?: number };

export type Board = { w: number; h: number; cards: Card[]; edges: Edge[] };

export const HEAD = 40;
export const ROW = 24;

const socketY = (index: number) => HEAD + 2 + index * ROW + ROW / 2;

const NORMAL = {
  top: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  bottom: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
} as const satisfies Record<Side, { dx: number; dy: number }>;

export const sidePoint = (card: Box, side: Side) => {
  const normal = NORMAL[side];
  return { x: card.x + card.w / 2 + (normal.dx * card.w) / 2, y: card.y + card.h / 2 + (normal.dy * card.h) / 2, ...normal };
};

const socketPoint = (card: Card, end: "from" | "to", socket: string | undefined) => {
  if (!("inputs" in card) || socket === undefined) return undefined;
  const index = (end === "from" ? card.outputs : card.inputs).findIndex((item) => item.id === socket);
  if (index < 0) return undefined;
  return end === "from" ? { x: card.x + card.w, y: card.y + socketY(index), dx: 1, dy: 0 } : { x: card.x, y: card.y + socketY(index), dx: -1, dy: 0 };
};

export const edgeGeometry = (edge: Edge, cards: Card[]) => {
  const from = cards.find((card) => card.id === edge.from);
  const to = cards.find((card) => card.id === edge.to);
  if (!from || !to) return undefined;
  const a = socketPoint(from, "from", edge.fromSocket) ?? sidePoint(from, edge.fromSide ?? "right");
  const b = socketPoint(to, "to", edge.toSocket) ?? sidePoint(to, edge.toSide ?? "left");
  const bend = Math.max(36, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const c1 = { x: a.x + a.dx * bend, y: a.y + a.dy * bend };
  const c2 = { x: b.x + b.dx * bend, y: b.y + b.dy * bend };
  return {
    path: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`,
    mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 },
    end: b,
  };
};

export const socketTop = (index: number) => socketY(index) - ROW / 2;

export const SOCKET_WORD = { text: "Text", number: "Number", file: "File", folder: "Folder" } as const satisfies Record<SocketType, string>;

import type { DOMImperativeFactory } from "expo/dom";
import type { ChipInfo, LinkOption } from "@lifeos/notes/editor";

export type TaskEvent = { id: number; ticket: number; kind: "saved" | "undone"; taskId?: string };

export type EditorTheme = Record<string, string>;

export type EditorHandle = DOMImperativeFactory & {
  todo: () => void;
  makeTask: () => void;
  link: () => void;
  heading: () => void;
  blur: () => void;
};

export type EditorBridge = {
  initial: string;
  incoming: { seq: number; update: string } | null;
  peers: { seq: number; update: string; ids: number[] } | null;
  events: TaskEvent[];
  chips: ChipInfo[];
  titles: string[];
  titled: boolean;
  placeholder: string;
  label: string;
  theme: EditorTheme;
  top: number;
  bottom: number;
  autoFocus: boolean;
  onUpdate: (update: string) => Promise<void>;
  onAck: (seq: number) => Promise<void>;
  onPresence: (update: string) => Promise<void>;
  suggest: (query: string) => Promise<LinkOption[]>;
  makeTask: (title: string, ticket: number) => Promise<void>;
  toggleTask: (id: string, done: boolean) => Promise<void>;
  openEntity: (table: "tasks" | "projects" | "areas", id: string) => Promise<void>;
  openNote: (title: string) => Promise<void>;
  onFocusChange: (focused: boolean) => Promise<void>;
};

import type { UiNode } from "@lifeos/backend/client/genui";

export type GuRow = Record<string, string | number>;
export type GuValue = string | number | boolean;
export type GuHaptic = "snap" | "drop" | "complete" | "error" | "toggle";

export type GuHost = {
  tables: Record<string, GuRow[]>;
  values: Record<string, GuValue>;
  waiting: Set<string>;
  haptic: (kind: GuHaptic) => void;
  call: (tool: string, args: Record<string, GuValue>) => Promise<boolean> | boolean;
  out?: (name: string, value: GuValue) => void;
  read?: (name: string, from: string, args: Record<string, string>) => void;
  part?: (is: string, id: string) => HTMLElement | undefined;
};

export type GuView = {
  render: (nodes: readonly UiNode[]) => void;
  setTable: (name: string, rows: GuRow[] | GuRow) => void;
  setValue: (name: string, value: GuValue) => void;
  stop: () => void;
};

export const GU_CSS: string;
export const mount: (target: HTMLElement, host: GuHost) => GuView;
export const setMorph: (maker: unknown) => void;
export const readCsv: (text: string) => GuRow[];

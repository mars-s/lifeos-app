"use client";

import { createContext, use } from "react";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import type { Mode } from "./modes";
import type { Route, Via } from "./route";

export type OpenCard = { key: string; instant: boolean };

export type Renaming = { kind: "area"; id: Id<"areas"> } | { kind: "project"; id: Id<"projects"> };

export type ListDraft = { kind: "area" } | { kind: "project"; areaId: Id<"areas"> | null };

export type Depth = "nav-forward" | "nav-back";

export type ShellState = {
  route: Route;
  via: Via;
  today: IsoDate;
  navigate: (route: Route, via: Via, depth?: Depth) => void;
  mode: Mode;
  switchMode: (mode: Mode, via: Via) => void;
  openCard: OpenCard | null;
  setOpenCard: (card: OpenCard | null, on?: Route) => void;
  closeCard: (key: string) => void;
  renaming: Renaming | null;
  setRenaming: (renaming: Renaming | null) => void;
  draft: ListDraft | null;
  setDraft: (draft: ListDraft | null) => void;
};

export const ShellContext = createContext<ShellState | null>(null);

export const liveShell: { current: ShellState | null } = { current: null };

export const useShell = () => {
  const shell = use(ShellContext);
  if (!shell) throw new Error("useShell needs the app shell around it.");
  return shell;
};

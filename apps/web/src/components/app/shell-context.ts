"use client";

import { createContext, use } from "react";
import type { IsoDate } from "@lifeos/backend/date";
import type { Route, Via } from "./route";

export type OpenCard = { key: string; instant: boolean };

export type ShellState = {
  route: Route;
  today: IsoDate;
  navigate: (route: Route, via: Via) => void;
  openCard: OpenCard | null;
  setOpenCard: (card: OpenCard | null) => void;
};

export const ShellContext = createContext<ShellState | null>(null);

export const useShell = () => {
  const shell = use(ShellContext);
  if (!shell) throw new Error("useShell needs the app shell around it.");
  return shell;
};

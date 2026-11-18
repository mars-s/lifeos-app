"use client";

import { createContext, useState, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const readSystem = () => (window.matchMedia(QUERY).matches ? "dark" : "light");
const readServer = () => "light" as const;

export const ThemeContext = createContext<Theme>("light");

export const useTheme = () => {
  const system = useSyncExternalStore(subscribe, readSystem, readServer);
  const [override, setOverride] = useState<Theme | null>(null);
  const setTheme = (theme: Theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    setOverride(theme);
  };
  return [override ?? system, setTheme] as const;
};

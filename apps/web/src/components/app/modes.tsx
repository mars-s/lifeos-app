"use client";

import { Kanban, Notebook, type Icon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { KeyCombo } from "@/components/ui/key-hint";
import { cn } from "@/lib/utils";
import { readStored, writeStored } from "../notes/stored";
import { parseRoute, type Route, type Via } from "./route";

export type Mode = "planner" | "notes";

export const MODES = [
  { mode: "planner", label: "Planner", icon: Kanban, keys: "mod+1", key: "1" },
  { mode: "notes", label: "Notes", icon: Notebook, keys: "mod+2", key: "2" },
] as const satisfies readonly { mode: Mode; label: string; icon: Icon; keys: string; key: string }[];

const HOME = { planner: "/today", notes: "/notes" } as const satisfies Record<Mode, string>;

const PLACES_KEY = "lifeos-mode-places";

export const modeOf = (route: Route) => (route.kind === "notes" ? "notes" : route.kind === "settings" ? null : "planner") satisfies Mode | null;

const readPlaces = () => {
  try {
    const stored: unknown = JSON.parse(readStored(PLACES_KEY) ?? "{}");
    const places = typeof stored === "object" && stored !== null ? (stored as Partial<Record<Mode, unknown>>) : {};
    return {
      planner: typeof places.planner === "string" ? places.planner : HOME.planner,
      notes: typeof places.notes === "string" ? places.notes : HOME.notes,
    } satisfies Record<Mode, string>;
  } catch {
    return { ...HOME };
  }
};

export const useModes = (route: Route, href: string) => {
  const routeMode = modeOf(route);
  const [kept, setKept] = useState<Mode>(routeMode ?? "planner");
  if (routeMode && routeMode !== kept) setKept(routeMode);
  const mode = routeMode ?? kept;
  const places = useRef<Record<Mode, string> | null>(null);
  useEffect(() => {
    places.current ??= readPlaces();
    if (!routeMode || places.current[routeMode] === href) return;
    places.current = { ...places.current, [routeMode]: href };
    writeStored(PLACES_KEY, JSON.stringify(places.current));
  }, [routeMode, href]);
  const placeOf = useCallback(
    (next: Mode) => {
      if (next === routeMode) return null;
      places.current ??= readPlaces();
      const place = parseRoute(places.current[next]);
      return modeOf(place) === next ? place : parseRoute(HOME[next]);
    },
    [routeMode],
  );
  return { mode, placeOf };
};

export const isModeKey = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey ? MODES.find((entry) => entry.key === event.key)?.mode : undefined;

export const ModeSwitch = ({ mode, via, onMode, className }: { mode: Mode; via: Via; onMode: (mode: Mode) => void; className?: string }) => (
  <div role="group" aria-label="Mode" data-mode-switch={mode} className={cn("relative grid shrink-0 grid-cols-2 rounded-[0.625rem] bg-foreground/[0.06] p-0.5", className)}>
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-lg bg-surface-raised shadow-lift motion-reduce:transition-none",
        via === "pointer" && "transition-transform duration-(--dur-fast) ease-out",
        mode === "notes" && "translate-x-full",
      )}
    />
    {MODES.map(({ mode: value, label, icon: ModeIcon, keys }) => (
      <Tooltip key={value} side="bottom" content={<span className="flex items-center gap-2">{label}<KeyCombo keys={keys} /></span>}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={mode === value}
          aria-keyshortcuts={`Meta+${keys.slice(-1)}`}
          onClick={() => onMode(value)}
          className={cn(
            "relative grid h-7 w-9 place-items-center rounded-lg outline-offset-[-2px] transition-[color,scale] duration-(--dur-press) ease-out active:scale-[0.94] pointer-coarse:h-9 pointer-coarse:w-11",
            mode === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ModeIcon weight={mode === value ? "fill" : "regular"} className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
    ))}
  </div>
);

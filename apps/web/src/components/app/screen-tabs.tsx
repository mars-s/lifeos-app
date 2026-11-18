"use client";

import type { Icon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { haptic } from "@/lib/haptics";
import { instant, spring } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { routeHref, sameRoute, type Route, type Via } from "./route";
import { useShell } from "./shell-context";

export type ScreenTab = { to: Route; label: string; icon: Icon };

const STEPS: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

export const ScreenTabs = ({ label, tabs, panel, className }: { label: string; tabs: readonly ScreenTab[]; panel: string; className?: string }) => {
  const { route, via, navigate } = useShell();
  const reduce = useReducedMotion();
  const pill = useId();
  const at = tabs.findIndex((tab) => sameRoute(route, tab.to));

  const open = (tab: ScreenTab, how: Via) => {
    if (how === "pointer" && !sameRoute(route, tab.to)) haptic("toggle");
    navigate(tab.to, how);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === " ") {
      event.preventDefault();
      return (event.target as HTMLElement).click();
    }
    const next = tabs[STEPS[event.key]?.(at, tabs.length) ?? -1];
    if (!next) return;
    event.preventDefault();
    open(next, "keyboard");
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${routeHref(next.to)}"]`)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("inline-flex h-9 shrink-0 items-center rounded-full bg-foreground/[0.05] p-0.5 shadow-well max-md:h-10", className)}
    >
      {tabs.map((tab, index) => {
        const active = index === at;
        const Glyph = tab.icon;
        return (
          <a
            key={routeHref(tab.to)}
            role="tab"
            href={routeHref(tab.to)}
            data-tab={routeHref(tab.to)}
            aria-selected={active}
            aria-controls={panel}
            tabIndex={active ? 0 : -1}
            draggable={false}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              open(tab, event.detail === 0 ? "keyboard" : "pointer");
            }}
            className={cn(
              "relative flex h-full items-center gap-1.5 rounded-full pr-3.5 pl-3 text-[0.875rem] font-medium outline-offset-2 transition-[color,scale] duration-(--dur-press) ease-out touch-manipulation [-webkit-tap-highlight-color:transparent] active:scale-[0.97]",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={pill}
                transition={reduce || via === "keyboard" ? instant : spring}
                className="absolute inset-0 rounded-full bg-surface-raised shadow-[inset_0_1px_0_light-dark(rgb(255_255_255/0.55),rgb(255_255_255/0.07)),0_1px_2px_light-dark(rgb(60_45_25/0.18),rgb(0_0_0/0.45))]"
              />
            )}
            <Glyph weight="fill" className={cn("relative size-4 shrink-0 transition-colors duration-(--dur-press) ease-out", active && "text-brand")} aria-hidden="true" />
            <span className="relative">{tab.label}</span>
          </a>
        );
      })}
    </div>
  );
};

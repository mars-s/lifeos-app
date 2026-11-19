"use client";

import { useEffect } from "react";
import type { SidebarView } from "@lifeos/backend/types";
import { useIsMac } from "@/components/ui/key-hint";
import { useNewTask } from "../new-task";
import { selection } from "../selection";
import { useSelectionActions } from "../selection-actions";
import { useShell } from "../shell-context";
import { CommandBar } from "./command-bar";
import { QuickCapture } from "./quick-capture";
import { ShortcutSheet } from "./shortcut-sheet";
import { bar, useBar } from "./store";

const BLOCKING = "[data-open-card], [role=menu], [role=dialog], [role=alertdialog]";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export const CommandBarHost = ({ sidebar }: { sidebar: SidebarView | undefined }) => {
  const state = useBar();
  const { today, openCard, navigate } = useShell();
  const onMac = useIsMac();
  const act = useSelectionActions(today);
  const newTask = useNewTask(sidebar);
  const openKey = openCard?.key;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.isComposing) return;
      const command = onMac ? event.metaKey && !event.ctrlKey : event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && !event.shiftKey && key === "k") {
        if (document.querySelector("[role=alertdialog]")) return;
        event.preventDefault();
        if (bar.state().kind === "commands") return bar.close();
        const held = openKey ? selection.task(openKey) : undefined;
        return bar.commands(held ? [held] : selection.tasks());
      }
      if (command && !event.shiftKey && event.key === ",") {
        if (document.querySelector("[role=alertdialog]")) return;
        event.preventDefault();
        bar.close();
        return navigate({ kind: "settings" }, "keyboard");
      }
      if (bar.state().kind !== "closed" || isTyping(event.target) || document.querySelector(BLOCKING)) return;
      const chosen = selection.tasks();
      if (command && !event.shiftKey && key === "n") {
        event.preventDefault();
        return newTask(true);
      }
      if (command && !event.shiftKey && (key === "t" || key === "e") && chosen.length > 0) {
        event.preventDefault();
        return act.setWhen(chosen, { kind: "scheduled", date: today, evening: key === "e" });
      }
      if (command || event.metaKey || event.ctrlKey) return;
      if (event.key === "?") {
        event.preventDefault();
        return bar.shortcuts();
      }
      if (event.shiftKey) return;
      if (key === "n" || key === "t") {
        event.preventDefault();
        return newTask(true, key === "t" ? { kind: "today" } : undefined);
      }
      if (key === "q") {
        event.preventDefault();
        bar.capture();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [act, navigate, newTask, onMac, openKey, today]);

  if (state.kind === "commands") return <CommandBar initialTargets={state.targets} sidebar={sidebar} />;
  if (state.kind === "capture") return <QuickCapture key={state.opened} initial={state.text} failed={state.failed} sidebar={sidebar} />;
  if (state.kind === "shortcuts") return <ShortcutSheet />;
  return null;
};

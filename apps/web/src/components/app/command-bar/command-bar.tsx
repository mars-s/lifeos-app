"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Command } from "cmdk";
import { useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { api } from "@lifeos/backend/api";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import { canUndo, undoLast } from "@/components/lifeos/undo";
import { Kbd, KeyCombo } from "@/components/ui/key-hint";
import { cn } from "@/lib/utils";
import { UPCOMING_DAYS } from "../dates";
import { useChange } from "../changes";
import { drafts, isDraftTask } from "../drafts";
import { useActiveFocus, useFocusActions } from "../focus";
import { useQuietView, valueOf } from "../hooks";
import { useNewTask } from "../new-task";
import { repeatActions } from "../repeat-actions";
import type { Route } from "../route";
import { selection } from "../selection";
import { useSelectionActions } from "../selection-actions";
import { replayWelcome } from "../settings/welcome-replay";
import { useShell } from "../shell-context";
import { useTemplateActions } from "../template-actions";
import { useFeatureOn, useFeatures } from "../settings/feature-state";
import type { IsoDate } from "@lifeos/backend/date";
import { BarDialog } from "./dialog";
import { fuzzyScore, rank } from "./fuzzy";
import {
  containerItems,
  createItems,
  deadlineItems,
  estimateItems,
  goItems,
  moreItems,
  moveItems,
  repeatItems,
  replayWelcomeItem,
  targetItems,
  targetLabel,
  taskItem,
  templateItems,
  whenItems,
  type BarItem,
  type Page,
  type TaskHit,
} from "./items";
import { readRecents, rememberRecent } from "./recents";
import { bar } from "./store";
import { planCommands } from "../planner/commands";

const PAGE_TITLE: Record<Exclude<Page, "root">, string> = { when: "When", deadline: "Deadline", estimate: "Estimate", move: "Move to", repeat: "Repeat" };
const PAGE_PLACEHOLDER: Record<Page, string> = {
  root: "Search Tasks, Projects, Areas and actions…",
  when: "Today, fri, next week, 12 dec…",
  deadline: "fri, next week, 12 dec…",
  estimate: "45, 1h30, 2h…",
  move: "Search Areas and Projects…",
  repeat: "Every day, weekday, month…",
};
const TASK_LIMIT = 7;
const CONTAINER_LIMIT = 5;
const PAGE_LIMIT = 40;
const CONTEXT_WEIGHT = 0.4;

const hitText = (task: PlannerTask) => `${task.title} ${task.context ?? ""} ${task.labels.map((label) => label.name).join(" ")}`.toLowerCase();

const useTaskIndex = (today: string) => {
  const inbox = useQuietView(api.planner.lists.inbox, {});
  const todayView = valueOf(useQuietView(api.planner.today.get, { date: today }));
  const upcoming = valueOf(useQuietView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS }));
  const anytime = valueOf(useQuietView(api.planner.lists.anytime, { date: today }));
  const someday = useQuietView(api.planner.lists.someday, {});
  return useMemo(() => {
    const hits = new Map<string, TaskHit>();
    const add = (tasks: readonly PlannerTask[] | undefined, home: Route) => {
      for (const task of tasks ?? []) if (!hits.has(task._id)) hits.set(task._id, { task, home, title: task.title.toLowerCase(), text: hitText(task) });
    };
    add(todayView?.tasks, { kind: "today" });
    add(todayView?.evening, { kind: "today" });
    add(inbox?.tasks, { kind: "inbox" });
    for (const day of upcoming?.days ?? []) {
      add(day.tasks, { kind: "upcoming" });
      add(day.deadlines, { kind: "upcoming" });
    }
    for (const group of anytime?.groups ?? []) add(group.tasks, { kind: "anytime" });
    for (const group of someday?.groups ?? []) add(group.tasks, { kind: "someday" });
    return hits;
  }, [inbox, todayView, upcoming, anytime, someday]);
};

const rankTasks = (query: string, index: ReadonlyMap<string, TaskHit>) => {
  const wanted = query.toLowerCase();
  const scored: { item: TaskHit; score: number }[] = [];
  for (const hit of index.values()) {
    const score = fuzzyScore(wanted, hit.title) || fuzzyScore(wanted, hit.text) * CONTEXT_WEIGHT;
    if (score > 0) scored.push({ item: hit, score });
  }
  return scored.toSorted((a, b) => b.score - a.score).slice(0, TASK_LIMIT);
};

const grouped = (items: readonly BarItem[]) => {
  const groups = new Map<string, BarItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups];
};

const Row = ({ item, onRun }: { item: BarItem; onRun: (item: BarItem) => void }) => (
  <Command.Item
    value={item.id}
    onSelect={() => onRun(item)}
    className="group/row flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-small data-[selected=true]:bg-foreground/[0.07]"
  >
    <span className="grid size-4 shrink-0 place-items-center">{item.leading}</span>
    <span className={cn("min-w-0 truncate", item.figure && "font-mono")}>{item.label}</span>
    {item.detail && <span className="min-w-0 flex-1 truncate text-faint-foreground">{item.detail}</span>}
    {item.keys && <KeyCombo keys={item.keys} className="ml-auto" />}
  </Command.Item>
);

export const CommandBar = ({ initialTargets, sidebar }: { initialTargets: readonly PlannerTask[]; sidebar: SidebarView | undefined }) => {
  const shell = useShell();
  const { today, route, navigate, setOpenCard, setDraft } = shell;
  const act = useSelectionActions(today);
  const focusDo = useFocusActions();
  const focus = useActiveFocus();
  const newTask = useNewTask(sidebar);
  const change = useChange();
  const templateDo = useTemplateActions();
  const templates = useQuietView(api.planner.templates.list, {});
  const templatesOn = useFeatureOn("templates");
  const features = useFeatures();
  const index = useTaskIndex(today);
  const [targets, setTargets] = useState(initialTargets);
  const [page, setPage] = useState<Page>("root");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo<BarItem[]>(() => {
    const go = (to: Route) => navigate(to, "keyboard");
    const open = ({ task, home }: TaskHit) => {
      const key = drafts.keyFor(task._id);
      selection.clear();
      navigate(home, "keyboard");
      setOpenCard({ key, instant: true }, home);
      requestAnimationFrame(() => document.querySelector(`[data-task-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" }));
    };
    const openTarget = (task: PlannerTask) => open(index.get(task._id) ?? { task, home: route, title: "", text: "" });
    const wanted = query.trim();
    const inApp = isTauri();

    if (page === "when") return rank(wanted, whenItems(targets, today, wanted, act, inApp), (item) => item.text, PAGE_LIMIT).map(({ item }) => item);
    if (page === "deadline") return rank(wanted, deadlineItems(targets, today, wanted, act), (item) => item.text, PAGE_LIMIT).map(({ item }) => item);
    if (page === "estimate") return rank(wanted, estimateItems(targets, wanted, act), (item) => item.text, PAGE_LIMIT).map(({ item }) => item);
    if (page === "move") return rank(wanted, moveItems(targets, sidebar, act), (item) => item.text, PAGE_LIMIT).map(({ item }) => item);
    const [one, ...others] = targets;
    const repeatable = one && others.length === 0 && one.status.kind === "open" && !isDraftTask(one._id) ? one : undefined;
    if (page === "repeat") {
      return repeatable
        ? rank(wanted, repeatItems(repeatable, today as IsoDate, repeatActions(change, repeatable, today)), (item) => item.text, PAGE_LIMIT).map(({ item }) => item)
        : [];
    }

    const onTargets = targetItems(targets, {
      act,
      focus,
      startFocus: (task) => focusDo.start(task, "keyboard"),
      open: openTarget,
      canRepeat: repeatable !== undefined,
      saveTemplate: templatesOn ? (task) => templateDo.save(task, today) : undefined,
    });
    const fromTemplates = templatesOn ? templateItems(templates ?? [], (template) => newTask(true, undefined, template)) : [];
    const goTo = goItems(go);
    const create = createItems({
      inApp,
      newTask: (into) => newTask(true, into),
      capture: () => bar.capture(),
      newProject: () => setDraft({ kind: "project", areaId: route.kind === "area" ? route.id : null }),
      newArea: () => setDraft({ kind: "area" }),
    });
    const more = moreItems({
      canUndo: canUndo(),
      undo: () => void undoLast(),
      focus,
      toggleFocus: focusDo.toggle,
      stopFocus: focusDo.stop,
      shortcuts: () => bar.shortcuts(),
      features: features.states,
      setFeature: (feature, enabled) => void features.setEnabled(feature, enabled),
      spreadToday: () => {
        if (planCommands.spread) return planCommands.spread(today as IsoDate);
        planCommands.pending = today as IsoDate;
        go({ kind: "planner" });
      },
    });
    const containers = containerItems(sidebar, go);
    const review = inApp || import.meta.env.DEV ? [replayWelcomeItem(replayWelcome)] : [];

    if (wanted === "") {
      const recent = readRecents().flatMap<BarItem>((entry) => {
        if (entry.kind === "task") {
          const hit = index.get(entry.id);
          return hit ? [taskItem(hit, today, open, "Recent")] : [];
        }
        const found =
          entry.kind === "list"
            ? goTo.find((item) => item.id === `go:${entry.id}`)
            : [...containers.projects, ...containers.areas].find((item) => item.id === `${entry.kind}:${entry.id}`);
        return found ? [{ ...found, id: `recent:${found.id}`, group: "Recent", keys: undefined }] : [];
      });
      return [...onTargets, ...recent, ...goTo, ...create, ...more];
    }

    const flat =
      targets.length === 0
        ? []
        : [
            ...whenItems(targets, today, wanted, act, inApp, "When: "),
            ...deadlineItems(targets, today, wanted, act, "Deadline: "),
            ...estimateItems(targets, wanted, act, "Estimate: "),
            ...moveItems(targets, sidebar, act, "Move to: "),
          ].map((item) => ({ ...item, group: onTargets[0]?.group ?? item.group, keys: undefined }));
    const pools = [
      rank(wanted, [...onTargets, ...flat], (item) => item.text, TASK_LIMIT),
      rankTasks(wanted, index).map(({ item, score }) => ({ item: taskItem(item, today, open), score })),
      rank(wanted, containers.projects, (item) => item.text, CONTAINER_LIMIT),
      rank(wanted, containers.areas, (item) => item.text, CONTAINER_LIMIT),
      rank(wanted, goTo, (item) => item.text, CONTAINER_LIMIT),
      rank(wanted, [...create, ...fromTemplates, ...more, ...review], (item) => item.text, CONTAINER_LIMIT),
    ].filter((pool) => pool.length > 0);
    const [first, ...rest] = pools;
    const leads = targets.length > 0 && first?.[0]?.item.group === onTargets[0]?.group;
    const ordered = leads && first ? [first, ...rest.toSorted((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0))] : pools.toSorted((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0));
    return [
      ...ordered.flat().map(({ item }) => item),
      {
        id: "capture:typed",
        group: "Capture",
        label: `Capture “${wanted}”`,
        text: "",
        leading: <span aria-hidden="true" className="size-3.5 rounded-[0.3rem] border-[1.5px] border-foreground/30" />,
        detail: "as a new Task",
        run: () => bar.capture(wanted),
      } satisfies BarItem,
    ];
  }, [act, change, focus, focusDo, index, navigate, newTask, page, query, route, setDraft, setOpenCard, sidebar, features, targets, templateDo, templates, templatesOn, today]);

  const highlighted = items.find((item) => item.id === active);

  const run = (item: BarItem) => {
    if (item.page) {
      setPage(item.page);
      setQuery("");
      return;
    }
    if (item.recent) rememberRecent(item.recent);
    bar.close();
    item.run?.();
  };

  const back = () => {
    if (page !== "root") {
      setPage("root");
      setQuery("");
      return true;
    }
    return false;
  };

  return (
    <BarDialog title="Command bar" onClose={bar.close} onEscape={back}>
      <Command
        label="Command bar"
        shouldFilter={false}
        loop
        value={active}
        onValueChange={setActive}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && query === "" && !back() && targets.length > 0) setTargets([]);
          if (event.key === "Tab" && page === "root" && highlighted?.task) {
            event.preventDefault();
            setTargets([highlighted.task]);
            setQuery("");
          }
        }}
        className="overflow-hidden rounded-2xl bg-popover text-foreground shadow-float"
      >
        <div className="flex h-12 items-center gap-2.5 px-4">
          <MagnifyingGlass weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {targets.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                setTargets([]);
                setPage("root");
                input.current?.focus();
              }}
              aria-label={`Actions apply to ${targetLabel(targets)}. Clear`}
              className="inline-flex h-6 max-w-44 shrink-0 items-center gap-1 rounded-md bg-brand/12 pr-1 pl-2 text-small font-medium text-brand transition-[background-color,scale] duration-(--dur-press) ease-out outline-none hover:bg-brand/20 focus-visible:ring-2 focus-visible:ring-brand/50 active:scale-[0.97]"
            >
              <span className={cn("truncate", targets.length > 1 && "font-mono")}>{targets.length > 1 ? targets.length : targetLabel(targets)}</span>
              {targets.length > 1 && <span>Tasks</span>}
              <X weight="bold" aria-hidden="true" className="size-3 opacity-60" />
            </button>
          )}
          {page !== "root" && (
            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-foreground/[0.06] px-2 text-small font-medium text-muted-foreground">
              {PAGE_TITLE[page]}
            </span>
          )}
          <Command.Input
            ref={input}
            value={query}
            onValueChange={setQuery}
            name="command"
            autoComplete="off"
            spellCheck={false}
            placeholder={PAGE_PLACEHOLDER[page]}
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="max-h-[min(24rem,60vh)] scroll-py-1.5 overflow-y-auto overscroll-contain bg-foreground/[0.03] p-1.5">
          <Command.Empty className="px-2.5 py-6 text-center text-small text-muted-foreground">Nothing here matches “{query.trim()}”.</Command.Empty>
          {grouped(items).map(([group, rows]) => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:text-faint-foreground"
            >
              {rows.map((item) => (
                <Row key={item.id} item={item} onRun={run} />
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex h-9 items-center gap-4 px-4 text-small text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <KeyCombo keys="enter" />
            {highlighted?.page ? "Choose" : highlighted?.task ? "Open" : "Run"}
          </span>
          {page === "root" && highlighted?.task && (
            <span className="flex items-center gap-1.5">
              <KeyCombo keys="tab" />
              Actions
            </span>
          )}
          {page !== "root" && (
            <span className="flex items-center gap-1.5">
              <KeyCombo keys="backspace" />
              Back
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <KeyCombo keys="up" />
            <KeyCombo keys="down" />
            Move
          </span>
        </div>
      </Command>
    </BarDialog>
  );
};

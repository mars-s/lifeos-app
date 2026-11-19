"use client";

import {
  ArrowBendUpRight,
  ArrowCounterClockwise,
  ArrowSquareOut,
  CalendarDots,
  CheckCircle,
  CheckSquare,
  Circle,
  Flag,
  HandWaving,
  Hourglass,
  Keyboard,
  Lightning,
  Pause,
  Play,
  Shapes,
  Sparkle,
  Stop,
  Timer,
  Trash,
  Tray,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { parseDatePhrase, parseWhenPhrase } from "@lifeos/backend/capture";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import { parseEstimateText } from "@lifeos/backend/estimate";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { formatMinutes } from "@/components/lifeos/format";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { isDraftId } from "../container-actions";
import { shortDay, weekdayLong, whenLabel } from "../dates";
import type { ActiveFocus } from "../focus";
import { LISTS, type Route } from "../route";
import type { MoveTarget, SelectionActions } from "../selection-actions";
import { LIST_META, PLANNER_META, SETTINGS_META } from "../sidebar";
import { WhenGlyph } from "./capture-chips";
import type { Recent } from "./recents";

export type Page = "root" | "when" | "deadline" | "estimate" | "move";

export type BarItem = {
  id: string;
  group: string;
  label: string;
  text: string;
  leading: ReactNode;
  detail?: string;
  keys?: string;
  run?: () => void;
  page?: Page;
  task?: PlannerTask;
  recent?: Recent;
  figure?: boolean;
};

export type TaskHit = { task: PlannerTask; home: Route; title: string; text: string };

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180];
const WEEKDAYS_AHEAD = [2, 3, 4, 5, 6];
const ICON = "size-4 shrink-0";

const lower = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

const on = (date: IsoDate) => ({ kind: "scheduled", date, evening: false }) satisfies PlannerTask["when"];

const areaSummary = (area: SidebarView["areas"][number]) => ({ _id: area._id, title: area.title, colour: area.colour, icon: area.icon });

const MUTED = `${ICON} text-muted-foreground`;

const plain = (group: string, id: string, label: string, leading: ReactNode, run: () => void, keys?: string, text = "") =>
  ({ id: `${group.toLowerCase()}:${id}`, group, label, text: `${label.toLowerCase()} ${text}`, leading, run, keys }) satisfies BarItem;

export const whenItems = (
  tasks: readonly PlannerTask[],
  today: IsoDate,
  query: string,
  act: SelectionActions,
  inApp: boolean,
  prefix = "",
) => {
  const set = (id: string, when: PlannerTask["when"], label: string, extra: Partial<BarItem> = {}) =>
    ({
      id: `when:${id}`,
      group: "When",
      label: `${prefix}${label}`,
      text: lower(prefix, label, extra.detail),
      leading: <WhenGlyph when={when} today={today} className={ICON} />,
      run: () => act.setWhen(tasks, when),
      ...extra,
    }) satisfies BarItem;
  const typed = parseWhenPhrase(query, today);
  return [
    ...(typed && typed.kind === "scheduled" && typed.date > addDays(today, 1)
      ? [set(`typed:${typed.date}`, typed, shortDay(typed.date), { text: query.trim().toLowerCase(), detail: weekdayLong(typed.date) })]
      : []),
    set("today", on(today), "Today", inApp ? { keys: "mod+t" } : {}),
    set("evening", { kind: "scheduled", date: today, evening: true }, "This Evening", { keys: "mod+e", text: lower(prefix, "this evening tonight") }),
    set("tomorrow", on(addDays(today, 1)), "Tomorrow", { detail: shortDay(addDays(today, 1)) }),
    ...WEEKDAYS_AHEAD.map((days) => set(`day:${days}`, on(addDays(today, days)), weekdayLong(addDays(today, days)), { detail: shortDay(addDays(today, days)) })),
    set("anytime", { kind: "anytime" }, "Anytime"),
    set("someday", { kind: "someday" }, "Someday"),
    set("inbox", { kind: "inbox" }, "Inbox"),
  ];
};

export const deadlineItems = (
  tasks: readonly PlannerTask[],
  today: IsoDate,
  query: string,
  act: SelectionActions,
  prefix = "",
) => {
  const set = (id: string, deadline: IsoDate | null, label: string, extra: Partial<BarItem> = {}) =>
    ({
      id: `deadline:${id}`,
      group: "Deadline",
      label: `${prefix}${label}`,
      text: lower(prefix, label, extra.detail),
      leading: deadline ? <Flag weight="fill" aria-hidden="true" className={`${ICON} text-deadline`} /> : <Circle aria-hidden="true" className={`${ICON} text-muted-foreground`} />,
      run: () => act.setDeadline(tasks, deadline),
      ...extra,
    }) satisfies BarItem;
  const typed = parseDatePhrase(query, today);
  return [
    ...(typed && typed > addDays(today, 1) ? [set(`typed:${typed}`, typed, shortDay(typed), { text: query.trim().toLowerCase(), detail: weekdayLong(typed) })] : []),
    set("today", today, "Today"),
    set("tomorrow", addDays(today, 1), "Tomorrow", { detail: shortDay(addDays(today, 1)) }),
    ...WEEKDAYS_AHEAD.map((days) => set(`day:${days}`, addDays(today, days), weekdayLong(addDays(today, days)), { detail: shortDay(addDays(today, days)) })),
    set("week", addDays(today, 7), "In a week", { detail: shortDay(addDays(today, 7)) }),
    ...(tasks.some((task) => task.deadline) ? [set("none", null, "No Deadline")] : []),
  ];
};

export const estimateItems = (tasks: readonly PlannerTask[], query: string, act: SelectionActions, prefix = "") => {
  const set = (minutes: number | null, text?: string) =>
    ({
      id: `estimate:${text ? "typed" : (minutes ?? "none")}`,
      group: "Estimate",
      label: `${prefix}${minutes === null ? "No Estimate" : formatMinutes(minutes)}`,
      text: text ?? lower(prefix, minutes === null ? "no estimate" : `${formatMinutes(minutes)} ${minutes}m ${minutes / 60}h`),
      leading: <Hourglass weight="fill" aria-hidden="true" className={`${ICON} text-muted-foreground`} />,
      run: () => act.setEstimate(tasks, minutes),
      figure: minutes !== null,
    }) satisfies BarItem;
  const typed = parseEstimateText(query).unwrapOr(null);
  return [
    ...(typed !== null && !ESTIMATES.includes(typed) ? [set(typed, query.trim().toLowerCase())] : []),
    ...ESTIMATES.map((minutes) => set(minutes)),
    ...(tasks.some((task) => task.estimateMinutes !== undefined) ? [set(null)] : []),
  ];
};

export const moveItems = (tasks: readonly PlannerTask[], sidebar: SidebarView | undefined, act: SelectionActions, prefix = "") => {
  const to = (id: string, label: string, leading: ReactNode, target: MoveTarget, detail?: string) =>
    ({ id: `move:${id}`, group: "Move to", label: `${prefix}${label}`, text: lower(prefix, label, detail), leading, detail, run: () => act.move(tasks, target) }) satisfies BarItem;
  const project = (entry: SidebarView["projects"][number], area?: SidebarView["areas"][number]) =>
    to(
      entry._id,
      entry.title,
      <ProgressPie value={entry.progress.total === 0 ? 0 : entry.progress.done / entry.progress.total} colour={area ? areaVar(area.colour) : "var(--muted-foreground)"} />,
      {
        parent: { kind: "project", projectId: entry._id },
        title: entry.title,
        project: { _id: entry._id, title: entry.title },
        ...(area ? { area: areaSummary(area) } : {}),
      },
      area?.title,
    );
  return [
    to("loose", "No Area or Project", <Tray weight="fill" aria-hidden="true" className={`${ICON} text-muted-foreground`} />, { parent: { kind: "loose" }, title: "no Area" }),
    ...(sidebar?.projects ?? []).filter((entry) => !isDraftId(entry._id)).map((entry) => project(entry)),
    ...(sidebar?.areas ?? [])
      .filter((area) => !isDraftId(area._id))
      .flatMap((area) => [
        to(area._id, area.title, <AreaGlyph colour={area.colour} icon={area.icon} />, { parent: { kind: "area", areaId: area._id }, title: area.title, area: areaSummary(area) }),
        ...area.projects.filter((entry) => !isDraftId(entry._id)).map((entry) => project(entry, area)),
      ]),
  ];
};

export const targetLabel = (tasks: readonly PlannerTask[]) => (tasks.length === 1 ? (tasks[0]?.title ?? "1 Task") : `${tasks.length} Tasks`);

export const targetItems = (
  tasks: readonly PlannerTask[],
  deps: {
    act: SelectionActions;
    focus: ActiveFocus | null;
    startFocus: (task: PlannerTask) => void;
    open: (task: PlannerTask) => void;
  },
) => {
  if (tasks.length === 0) return [];
  const group = tasks.length === 1 ? "This Task" : `${tasks.length} Tasks selected`;
  const count = tasks.length === 1 ? "" : ` ${tasks.length} Tasks`;
  const one = tasks.length === 1 ? tasks[0] : undefined;
  const closed = tasks.every((task) => task.status.kind !== "open");
  const muted = `${ICON} text-muted-foreground`;
  const item = (id: string, label: string, leading: ReactNode, rest: Partial<BarItem>) =>
    ({ id: `target:${id}`, group, label, text: label.toLowerCase(), leading, ...rest }) satisfies BarItem;
  return [
    closed
      ? item("reopen", `Reopen${count}`, <Circle aria-hidden="true" className={muted} />, { run: () => deps.act.reopen(tasks) })
      : item("complete", `Complete${count}`, <CheckCircle weight="fill" aria-hidden="true" className={`${ICON} text-brand`} />, {
          run: () => deps.act.completeSoon(tasks),
          text: `complete done finish${count.toLowerCase()}`,
        }),
    item("when", "When…", <CalendarDots weight="fill" aria-hidden="true" className={muted} />, { page: "when", text: "when schedule date" }),
    item("deadline", "Deadline…", <Flag weight="fill" aria-hidden="true" className={muted} />, { page: "deadline", text: "deadline due" }),
    item("estimate", "Estimate…", <Hourglass weight="fill" aria-hidden="true" className={muted} />, { page: "estimate", text: "estimate allocated time" }),
    item("move", "Move to…", <ArrowBendUpRight weight="fill" aria-hidden="true" className={muted} />, { page: "move", text: "move to area project" }),
    ...(one && one.status.kind === "open" && deps.focus?.taskId !== one._id
      ? [item("focus", "Start Focus Session", <Timer weight="fill" aria-hidden="true" className={muted} />, { keys: "f", run: () => deps.startFocus(one) })]
      : []),
    ...(one ? [item("open", "Open", <ArrowSquareOut weight="fill" aria-hidden="true" className={muted} />, { keys: "enter", run: () => deps.open(one) })] : []),
    item("trash", `Move${count} to Trash`, <Trash weight="fill" aria-hidden="true" className={muted} />, {
      keys: "backspace",
      run: () => deps.act.trash(tasks),
      text: `move to trash delete${count.toLowerCase()}`,
    }),
  ];
};

export const goItems = (go: (route: Route) => void) => {
  const order = ["inbox", "today", "planner", "upcoming", "anytime", "someday", "logbook", "trash"] as const;
  const settings = {
    id: "go:settings",
    group: "Go to",
    label: SETTINGS_META.label,
    text: "settings preferences permissions account sign out sync connections go to",
    leading: <SETTINGS_META.icon weight="fill" aria-hidden="true" className={`${ICON} text-muted-foreground`} />,
    keys: "mod+,",
    run: () => go({ kind: "settings" }),
  } satisfies BarItem;
  const lists = order.map((kind) => {
    const meta = kind === "planner" ? PLANNER_META : LIST_META[kind];
    const key = kind === "planner" ? "8" : String(LISTS.indexOf(kind) + 1);
    return {
      id: `go:${kind}`,
      group: "Go to",
      label: meta.label,
      text: `${meta.label.toLowerCase()} go to`,
      leading: <meta.icon weight="fill" aria-hidden="true" className={`${ICON} text-muted-foreground`} />,
      keys: key,
      run: () => go({ kind }),
      recent: { kind: "list", id: kind },
    } satisfies BarItem;
  });
  return [...lists, settings];
};

export const createItems = (deps: {
  inApp: boolean;
  newTask: (into?: Route) => void;
  capture: () => void;
  newProject: () => void;
  newArea: () => void;
}) => {
  const muted = MUTED;
  const item = plain.bind(null, "Create");
  return [
    item("task", "New Task", <CheckSquare weight="fill" aria-hidden="true" className={muted} />, () => deps.newTask(), deps.inApp ? "mod+n" : "n", "add create"),
    item("capture", "Quick capture", <Lightning weight="fill" aria-hidden="true" className={muted} />, deps.capture, "q", "add inbox brain dump"),
    item("today", "New Task in Today", <LIST_META.today.icon weight="fill" aria-hidden="true" className={muted} />, () => deps.newTask({ kind: "today" }), "t", "add create"),
    item("project", "New Project", <Circle aria-hidden="true" className={muted} />, deps.newProject, undefined, "add create"),
    item("area", "New Area", <Shapes weight="fill" aria-hidden="true" className={muted} />, deps.newArea, undefined, "add create"),
  ];
};

export const moreItems = (deps: {
  canUndo: boolean;
  undo: () => void;
  focus: ActiveFocus | null;
  toggleFocus: () => void;
  stopFocus: () => void;
  shortcuts: () => void;
  smartEstimates: { enabled: boolean; configured: boolean } | undefined;
  setSmartEstimates: (enabled: boolean) => void;
}) => {
  const muted = MUTED;
  const item = plain.bind(null, "More");
  const smart = deps.smartEstimates;
  const paused = deps.focus?.state.kind === "paused";
  return [
    ...(deps.canUndo ? [item("undo", "Undo the last change", <ArrowCounterClockwise weight="bold" aria-hidden="true" className={muted} />, deps.undo, "mod+z")] : []),
    ...(deps.focus
      ? [
          item(
            "focus-toggle",
            paused ? "Resume Focus Session" : "Pause Focus Session",
            paused ? <Play weight="fill" aria-hidden="true" className={muted} /> : <Pause weight="fill" aria-hidden="true" className={muted} />,
            deps.toggleFocus,
            "f",
            deps.focus.title.toLowerCase(),
          ),
          item("focus-stop", "Stop Focus Session", <Stop weight="fill" aria-hidden="true" className={muted} />, deps.stopFocus, undefined, deps.focus.title.toLowerCase()),
        ]
      : []),
    ...(smart
      ? [
          {
            ...item(
              "smart-estimates",
              smart.enabled ? "Turn Smart Estimates off" : "Turn Smart Estimates on",
              <Sparkle weight="fill" aria-hidden="true" className={muted} />,
              () => deps.setSmartEstimates(!smart.enabled),
              undefined,
              "suggest estimate openai settings preference",
            ),
            ...(smart.configured ? {} : { detail: "Not set up" }),
          },
        ]
      : []),
    item("shortcuts", "Keyboard shortcuts", <Keyboard weight="fill" aria-hidden="true" className={muted} />, deps.shortcuts, "shift+/", "help keys"),
  ];
};

export const replayWelcomeItem = (replay: () => void) =>
  plain("More", "replay-welcome", "Replay Welcome", <HandWaving weight="fill" aria-hidden="true" className={MUTED} />, replay, undefined, "onboarding first run setup intro");

export const taskItem = (hit: TaskHit, today: string, open: (hit: TaskHit) => void, group = "Tasks") =>
  ({
    id: `task:${hit.task._id}`,
    group,
    label: hit.task.title,
    text: hit.text,
    leading: <WhenGlyph when={hit.task.when} today={today} className={ICON} />,
    detail: [hit.task.context, whenLabel(hit.task.when, today)].filter(Boolean).join(" · "),
    run: () => open(hit),
    task: hit.task,
    recent: { kind: "task", id: hit.task._id },
  }) satisfies BarItem;

export const containerItems = (sidebar: SidebarView | undefined, go: (route: Route) => void) => {
  const project = (entry: SidebarView["projects"][number], area?: SidebarView["areas"][number]) =>
    ({
      id: `project:${entry._id}`,
      group: "Projects",
      label: entry.title,
      text: lower(entry.title, area?.title),
      leading: <ProgressPie value={entry.progress.total === 0 ? 0 : entry.progress.done / entry.progress.total} colour={area ? areaVar(area.colour) : "var(--muted-foreground)"} />,
      detail: area?.title,
      run: () => go({ kind: "project", id: entry._id }),
      recent: { kind: "project", id: entry._id },
    }) satisfies BarItem;
  const areas = (sidebar?.areas ?? []).filter((area) => !isDraftId(area._id));
  return {
    projects: [
      ...(sidebar?.projects ?? []).filter((entry) => !isDraftId(entry._id)).map((entry) => project(entry)),
      ...areas.flatMap((area) => area.projects.filter((entry) => !isDraftId(entry._id)).map((entry) => project(entry, area))),
    ],
    areas: areas.map(
      (area) =>
        ({
          id: `area:${area._id}`,
          group: "Areas",
          label: area.title,
          text: area.title.toLowerCase(),
          leading: <AreaGlyph colour={area.colour} icon={area.icon} />,
          run: () => go({ kind: "area", id: area._id }),
          recent: { kind: "area", id: area._id },
        }) satisfies BarItem,
    ),
  };
};

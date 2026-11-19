"use client";

import {
  Archive,
  CalendarDots,
  ChartPieSlice,
  CheckCircle,
  CheckSquare,
  Circle,
  FolderSimple,
  Flag,
  Hourglass,
  Moon,
  PaintBrush,
  PencilSimple,
  Plus,
  Shapes,
  SquaresFour,
  Stack,
  Star,
  Tag,
  Timer,
  Trash,
  Tray,
  ArrowBendUpRight,
  ArrowSquareOut,
  SelectionAll,
  ArrowDown,
  ArrowUp,
  ArrowUUpLeft,
  CalendarPlus,
  Check,
  Repeat,
  SkipForward,
  XCircle,
  Stamp,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { addDays } from "@lifeos/backend/date";
import type { PlannerTask, RecurringOccurrence, SidebarView } from "@lifeos/backend/types";
import { AREA_COLOURS, AreaDot, areaVar, type AreaColour } from "@/components/lifeos/area";
import { AREA_ICONS, AreaGlyph, type AreaIconName } from "@/components/lifeos/area-icon";
import { MonthGrid } from "@/components/lifeos/date-pickers";
import { formatMinutes } from "@/components/lifeos/format";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { NEVER, baseDate, isPreset, repeatDay, repeatLabel, repeatPresets, sameSchedule, scheduleParts, type RepeatEnd, type RepeatMode, type Schedule } from "@/components/lifeos/repeat";
import { RepeatCustom } from "@/components/lifeos/repeat-picker";
import { ContextMenu, type MenuGroup, type MenuItem } from "@/components/ui/action-menu";
import { haptic } from "@/lib/haptics";
import { EASE_OUT, instant } from "@/lib/motion-tokens";
import { useChange } from "./changes";
import { UPCOMING_DAYS } from "./dates";
import {
  areaStepKey,
  isDraftId,
  projectStepKey,
  useContainerActions,
  type SidebarArea,
  type SidebarProject,
} from "./container-actions";
import { isDraftTask } from "./drafts";
import { useActiveFocus, useFocusActions } from "./focus";
import { useQuietView, valueOf } from "./hooks";
import { useNewTask } from "./new-task";
import { repeatActions, useOccurrenceActions } from "./repeat-actions";
import { selection, useRegisteredTasks, useSelectionSize } from "./selection";
import { useSelectionActions, type MoveTarget } from "./selection-actions";
import { planCommands } from "./planner/commands";
import { useConvertToProject } from "./project-conversion";
import { useShell } from "./shell-context";
import { isOptimistic } from "./task-actions";
import { useFeatureOn } from "./settings/feature-state";
import { useTemplateActions } from "./template-actions";
import { useTrashActions } from "./trash-actions";

type Target =
  | { kind: "tasks"; key: string }
  | { kind: "area"; id: string }
  | { kind: "project"; id: string }
  | { kind: "trash"; id: string }
  | { kind: "occurrence"; ruleId: string; date: string }
  | { kind: "empty" };

type PointPick = { x: number; y: number; label: string; body: ReactNode };

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180];
const MENU_CLOSE_MS = 140;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const targetOf: (element: Element) => Target = (element) => {
  const row = element.closest<HTMLElement>("[data-task-key]");
  if (row?.dataset.taskKey) return { kind: "tasks", key: row.dataset.taskKey };
  const occurrence = element.closest<HTMLElement>("[data-menu-occurrence]");
  if (occurrence?.dataset.menuOccurrence) {
    return { kind: "occurrence", ruleId: occurrence.dataset.menuOccurrence, date: occurrence.dataset.occurrenceDate ?? "" };
  }
  const trashed = element.closest<HTMLElement>("[data-menu-trash]");
  if (trashed?.dataset.menuTrash) return { kind: "trash", id: trashed.dataset.menuTrash.split(":")[1] ?? "" };
  const area = element.closest<HTMLElement>("[data-menu-area]");
  const project = element.closest<HTMLElement>("[data-menu-project]");
  if (project?.dataset.menuProject && (!area || area.contains(project))) return { kind: "project", id: project.dataset.menuProject };
  if (area?.dataset.menuArea) return { kind: "area", id: area.dataset.menuArea };
  return { kind: "empty" };
};

export const openMenuFor = (element: Element, viaKeyboard = false) => {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: viaKeyboard ? box.left + Math.min(box.width / 2, 120) : box.left,
      clientY: viaKeyboard ? box.top + box.height / 2 : box.bottom + 6,
      detail: viaKeyboard ? 0 : 1,
    }),
  );
};

const stepItems: (up: string | null, down: string | null, move: (order: string) => void) => MenuItem[] = (up, down, move) => [
  { id: "move-up", label: "Move Up", icon: ArrowUp, shortcut: "⌘↑", disabled: up === null, onSelect: () => up && move(up) },
  { id: "move-down", label: "Move Down", icon: ArrowDown, shortcut: "⌘↓", disabled: down === null, onSelect: () => down && move(down) },
];

const PointPopover = ({ pick, onClose }: { pick: PointPick | null; onClose: () => void }) => {
  const reduce = useReducedMotion();
  const x = pick?.x ?? 0;
  const y = pick?.y ?? 0;
  const anchor = useMemo(() => ({ current: { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) } }), [x, y]);
  return (
    <PopoverPrimitive.Root open={pick !== null} onOpenChange={(open) => !open && onClose()}>
      <PopoverPrimitive.Anchor virtualRef={anchor} />
      <AnimatePresence>
        {pick && (
          <PopoverPrimitive.Portal forceMount>
            <PopoverPrimitive.Content
              forceMount
              asChild
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={12}
              aria-label={pick.label}
              onFocusOutside={(event) => event.preventDefault()}
            >
              <motion.div
                initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: reduce ? instant : { duration: 0.16, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: reduce ? instant : { duration: 0.1, ease: EASE_OUT } }}
                style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
                className="z-50 max-h-(--radix-popover-content-available-height) w-[17.5rem] overflow-y-auto overscroll-contain rounded-[1.25rem] bg-popover p-1.5 text-foreground shadow-float outline-none"
              >
                <p className="px-2.5 pt-1.5 text-micro font-medium text-faint-foreground">{pick.label}</p>
                {pick.body}
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </AnimatePresence>
    </PopoverPrimitive.Root>
  );
};

const mark = (on: boolean) => <Check weight="bold" className={on ? "size-3.5 text-brand" : "invisible size-3.5"} />;

const shared = <T,>(tasks: readonly PlannerTask[], read: (task: PlannerTask) => T) => {
  const first = tasks[0] ? JSON.stringify(read(tasks[0])) : undefined;
  return tasks.every((task) => JSON.stringify(read(task)) === first) && tasks[0] ? read(tasks[0]) : undefined;
};

export const AppMenu = ({ sidebar, children }: { sidebar: SidebarView | undefined; children: ReactNode }) => {
  const shell = useShell();
  const { today, route, navigate, setOpenCard, setRenaming, setDraft } = shell;
  const change = useChange();
  const tasksDo = useSelectionActions(today);
  const focusDo = useFocusActions();
  const focusNow = useActiveFocus();
  const containersDo = useContainerActions(shell);
  const labels = useQuietView(api.planner.labels.list, {}) ?? [];
  const trashRows = useQuietView(api.planner.trash.list, route.kind === "trash" ? {} : "skip")?.rows ?? [];
  const trashDo = useTrashActions();
  const root = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target>({ kind: "empty" });
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const [pointPick, setPointPick] = useState<PointPick | null>(null);
  const occurrences = valueOf(useQuietView(api.planner.recurrence.upcoming, route.kind === "upcoming" ? { date: today, days: UPCOMING_DAYS } : "skip"));
  const occurrenceDo = useOccurrenceActions();
  const templatesOn = useFeatureOn("templates");
  const templates = useQuietView(api.planner.templates.list, {}) ?? [];
  const templateDo = useTemplateActions();
  const convertToProject = useConvertToProject();
  useRegisteredTasks();
  useSelectionSize();

  const newTask = useNewTask(sidebar);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const wantsMenu = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      if (wantsMenu && !isTyping(event.target)) {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !root.current?.contains(focused)) return;
        event.preventDefault();
        openMenuFor(focused, true);
        return;
      }
      if (event.defaultPrevented || isTyping(event.target) || event.altKey) return;
      if (document.querySelector("[data-open-card], [role=menu], [role=dialog]")) return;
      const command = event.metaKey || event.ctrlKey;
      const chosen = selection.tasks();
      if (!command && !event.shiftKey && (event.key === "Backspace" || event.key === "Delete") && chosen.length > 0) {
        event.preventDefault();
        tasksDo.trash(chosen);
        return;
      }
      if (!command && !event.shiftKey && event.key.toLowerCase() === "f") {
        const [only, ...others] = chosen;
        if (only && others.length === 0 && only.status.kind === "open") {
          event.preventDefault();
          focusDo.start(only, "keyboard");
        } else if (!only && focusNow) {
          event.preventDefault();
          focusDo.toggle();
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tasksDo, focusDo, focusNow]);

  const touched = useRef<{ element: Element; x: number; y: number } | null>(null);

  const prepare = (element: Element, at: { x: number; y: number }, keyboard: boolean) => {
    const onBar = element.closest("[data-selection-bar]") !== null;
    const next = targetOf(element);
    if (next.kind === "tasks" && !selection.has(next.key)) selection.only(next.key);
    if (next.kind !== "tasks" && !onBar) selection.clear();
    setTarget(onBar ? { kind: "tasks", key: selection.keys()[0] ?? "" } : next);
    setPoint({ x: at.x, y: at.y });
    setViaKeyboard(keyboard);
    haptic("snap");
  };

  const areas = sidebar?.areas ?? [];
  const looseProjects = sidebar?.projects ?? [];

  const openAtPoint = (label: string, body: ReactNode) => setTimeout(() => setPointPick({ ...point, label, body }), MENU_CLOSE_MS);

  const pickDate = (label: string, tone: "brand" | "deadline", value: string | undefined, pick: (date: string) => void) =>
    openAtPoint(label, <MonthGrid value={value} today={today} tone={tone} onPick={pick} />);

  const repeatGroups: (task: PlannerTask) => MenuGroup[] = (task) => {
    const actions = repeatActions(change, task, today);
    const repeat = task.repeat?.active ? task.repeat : undefined;
    const base = baseDate(task.when, today);
    const end: RepeatEnd = repeat?.end ?? NEVER;
    const custom = (mode: RepeatMode) => () =>
      openAtPoint(
        "Repeat",
        <RepeatCustom
          schedule={repeat?.schedule}
          end={end}
          base={base}
          today={today}
          mode={mode}
          cancelLabel="Cancel"
          onCancel={() => setPointPick(null)}
          onCommit={(schedule, chosen) => {
            setPointPick(null);
            actions.set(schedule, chosen);
          }}
        />,
      );
    const choice = (schedule: Schedule) => {
      const parts = scheduleParts(schedule);
      const on = sameSchedule(schedule, repeat?.schedule);
      return {
        id: JSON.stringify(schedule),
        label: (
          <>
            {parts.lead}
            {parts.qualifier && <span className="text-faint-foreground"> ({parts.qualifier})</span>}
          </>
        ),
        leading: mark(on),
        onSelect: () => on || actions.set(schedule, end),
      } satisfies MenuItem;
    };
    const odd = repeat && repeat.schedule.kind !== "afterCompletion" && !isPreset(repeat.schedule, base) ? repeat.schedule : undefined;
    return [
      {
        items: [
          { id: "none", label: "Does not repeat", leading: mark(!repeat), onSelect: actions.stop },
          ...repeatPresets(base).map(choice),
        ],
      },
      {
        items: [
          ...(odd ? [{ id: "odd", label: repeatLabel(odd, NEVER), leading: mark(true), onSelect: custom("calendar") } satisfies MenuItem] : []),
          {
            id: "after",
            label: repeat?.schedule.kind === "afterCompletion" ? repeatLabel(repeat.schedule, NEVER) : "After I finish it…",
            leading: mark(repeat?.schedule.kind === "afterCompletion"),
            onSelect: custom("afterCompletion"),
          },
          { id: "custom", label: "Custom…", leading: mark(false), onSelect: custom("calendar") },
        ],
      },
      {
        items:
          repeat?.next.kind === "due"
            ? [{ id: "skip", label: `Skip ${repeatDay(repeat.next.date)}`, icon: SkipForward, onSelect: actions.skip } satisfies MenuItem]
            : [],
      },
    ];
  };

  const occurrenceGroups: (row: RecurringOccurrence) => MenuGroup[] = (row) => [
    { items: [{ id: "skip", label: "Skip This One", icon: SkipForward, onSelect: () => occurrenceDo.skip(row) }] },
    { items: [{ id: "stop", label: "Stop Repeating", icon: XCircle, disabled: !row.taskId, onSelect: () => occurrenceDo.stop(row) }] },
  ];

  const whenItems: (
    current: PlannerTask["when"] | undefined,
    set: (when: PlannerTask["when"]) => void,
    withInbox: boolean,
  ) => MenuGroup[] = (current, set, withInbox) => {
    const isScheduled = current?.kind === "scheduled";
    return [
      {
        items: [
          { id: "today", label: "Today", icon: Star, accent: true, onSelect: () => set({ kind: "scheduled", date: today, evening: false }) },
          { id: "evening", label: "This Evening", icon: Moon, onSelect: () => set({ kind: "scheduled", date: today, evening: true }) },
          {
            id: "tomorrow",
            label: "Tomorrow",
            icon: CalendarDots,
            onSelect: () => set({ kind: "scheduled", date: addDays(today, 1), evening: false }),
          },
          {
            id: "pick",
            label: "Pick a Date…",
            icon: SquaresFour,
            onSelect: () =>
              pickDate("When", "brand", isScheduled && current.date > today ? current.date : undefined, (date) =>
                set({ kind: "scheduled", date, evening: false }),
              ),
          },
        ],
      },
      {
        items: [
          { id: "anytime", label: "Anytime", icon: Stack, onSelect: () => set({ kind: "anytime" }) },
          { id: "someday", label: "Someday", icon: Archive, onSelect: () => set({ kind: "someday" }) },
          ...(withInbox ? [{ id: "inbox", label: "Inbox", icon: Tray, onSelect: () => set({ kind: "inbox" }) } satisfies MenuItem] : []),
        ],
      },
    ];
  };

  const deadlineItems: (current: string | undefined, hasOne: boolean, set: (deadline: string | null) => void) => MenuGroup[] = (
    current,
    hasOne,
    set,
  ) => [
    {
      items: [
        { id: "today", label: "Today", icon: Flag, onSelect: () => set(today) },
        { id: "tomorrow", label: "Tomorrow", icon: Flag, onSelect: () => set(addDays(today, 1)) },
        { id: "week", label: "In a Week", icon: Flag, onSelect: () => set(addDays(today, 7)) },
        { id: "pick", label: "Pick a Date…", icon: SquaresFour, onSelect: () => pickDate("Deadline", "deadline", current, set) },
      ],
    },
    { items: hasOne ? [{ id: "none", label: "No Deadline", icon: Circle, onSelect: () => set(null) }] : [] },
  ];

  const moveGroups: (tasks: readonly PlannerTask[]) => MenuGroup[] = (tasks) => {
    const to = (destination: MoveTarget) => () => tasksDo.move(tasks, destination);
    const projectItem: (project: SidebarProject, area: SidebarArea | undefined, indent: boolean) => MenuItem = (project, area, indent) => ({
      id: project._id,
      label: project.title,
      indent,
      leading: (
        <ProgressPie
          value={project.progress.total === 0 ? 0 : project.progress.done / project.progress.total}
          colour={area ? areaVar(area.colour) : "var(--muted-foreground)"}
        />
      ),
      disabled: isDraftId(project._id),
      onSelect: to({
        parent: { kind: "project", projectId: project._id },
        title: project.title,
        project: { _id: project._id, title: project.title },
        ...(area ? { area: { _id: area._id, title: area.title, colour: area.colour, icon: area.icon } } : {}),
      }),
    });
    return [
      { items: [{ id: "loose", label: "No Area or Project", icon: Tray, onSelect: to({ parent: { kind: "loose" }, title: "no Area" }) }] },
      { items: looseProjects.map((project) => projectItem(project, undefined, false)) },
      ...areas.map((area) => ({
        id: area._id,
        items: [
          {
            id: area._id,
            label: area.title,
            leading: <AreaGlyph colour={area.colour} icon={area.icon} />,
            disabled: isDraftId(area._id),
            onSelect: to({
              parent: { kind: "area", areaId: area._id },
              title: area.title,
              area: { _id: area._id, title: area.title, colour: area.colour, icon: area.icon },
            }),
          } satisfies MenuItem,
          ...area.projects.map((project) => projectItem(project, area, true)),
        ],
      })),
    ];
  };

  const taskGroups: (key: string) => MenuGroup[] = (key) => {
    const tasks = selection.tasks();
    const one = tasks.length === 1 ? tasks[0] : undefined;
    if (tasks.length === 0) return emptyGroups();
    const count = tasks.length === 1 ? "" : ` ${tasks.length} Tasks`;
    const closed = tasks.every((task) => task.status.kind !== "open");
    const touch = window.matchMedia("(pointer: coarse)").matches;
    return [
      {
        items: [
          ...(one
            ? [
                {
                  id: "open",
                  label: "Open",
                  icon: ArrowSquareOut,
                  shortcut: "↵",
                  onSelect: () => setOpenCard({ key, instant: false }),
                } satisfies MenuItem,
              ]
            : []),
          ...(one && one.status.kind === "open"
            ? [
                focusNow?.taskId === one._id
                  ? ({ id: "focus", label: "Stop Focus Session", icon: Timer, onSelect: () => focusDo.stop() } satisfies MenuItem)
                  : ({
                      id: "focus",
                      label: "Start Focus Session",
                      icon: Timer,
                      shortcut: "F",
                      onSelect: () => focusDo.start(one, viaKeyboard ? "keyboard" : "pointer"),
                    } satisfies MenuItem),
              ]
            : []),
          ...(one && one.status.kind === "open" && route.kind === "planner"
            ? [
                {
                  id: "block",
                  label: "Add Work Block",
                  icon: CalendarPlus,
                  shortcut: "B",
                  onSelect: () => planCommands.addBlock?.(one),
                } satisfies MenuItem,
              ]
            : []),
          ...(one && templatesOn ? [{ id: "template", label: "Save as Template", icon: Stamp, onSelect: () => templateDo.save(one, today) } satisfies MenuItem] : []),
          ...(touch && one
            ? [{ id: "select", label: "Select More", icon: SelectionAll, onSelect: () => selection.only(key) } satisfies MenuItem]
            : []),
        ],
      },
      {
        items: [
          {
            id: "when",
            type: "submenu",
            label: "When",
            icon: CalendarDots,
            items: [],
            groups: whenItems(shared(tasks, (task) => task.when), (when) => tasksDo.setWhen(tasks, when), true),
          },
          {
            id: "deadline",
            type: "submenu",
            label: "Deadline",
            icon: Flag,
            items: [],
            groups: deadlineItems(
              shared(tasks, (task) => task.deadline ?? null) ?? undefined,
              tasks.some((task) => task.deadline),
              (deadline) => tasksDo.setDeadline(tasks, deadline),
            ),
          },
          {
            id: "estimate",
            type: "submenu",
            label: "Estimate",
            icon: Hourglass,
            items: [],
            groups: [
              {
                items: ESTIMATES.map((minutes) => ({
                  id: String(minutes),
                  label: <span className="font-mono">{formatMinutes(minutes)}</span>,
                  onSelect: () => tasksDo.setEstimate(tasks, minutes),
                })),
              },
              {
                items: tasks.some((task) => task.estimateMinutes !== undefined)
                  ? [{ id: "none", label: "No Estimate", onSelect: () => tasksDo.setEstimate(tasks, null) }]
                  : [],
              },
            ],
          },
          {
            id: "labels",
            type: "submenu",
            label: "Labels",
            icon: Tag,
            disabled: labels.length === 0,
            items: labels.map((label) => {
              const holders = tasks.filter((task) => task.labelIds.includes(label._id)).length;
              return {
                id: label._id,
                type: "checkbox",
                label: label.name,
                leading: <AreaDot colour={label.colour} className="size-2" />,
                checked: holders === 0 ? false : holders === tasks.length ? true : "mixed",
                onCheckedChange: (on) => tasksDo.setLabel(selection.tasks(), label, on),
              } satisfies MenuItem;
            }),
          },
          { id: "move", type: "submenu", label: "Move to", icon: ArrowBendUpRight, items: [], groups: moveGroups(tasks) },
          ...(one && one.status.kind === "open" && !isDraftTask(one._id)
            ? [{ id: "repeat", type: "submenu", label: "Repeat", icon: Repeat, items: [], groups: repeatGroups(one) } satisfies MenuItem]
            : []),
          ...(one && one.status.kind === "open" && !isDraftTask(one._id)
            ? [
                {
                  id: "project",
                  label: "Convert to Project",
                  icon: ChartPieSlice,
                  onSelect: () => convertToProject(one, viaKeyboard ? "keyboard" : "pointer"),
                } satisfies MenuItem,
              ]
            : []),
        ],
      },
      {
        items: [
          closed
            ? { id: "reopen", label: `Reopen${count}`, icon: Circle, onSelect: () => tasksDo.reopen(tasks) }
            : { id: "complete", label: `Complete${count}`, icon: CheckCircle, shortcut: "⌘K ↵", onSelect: () => tasksDo.completeSoon(tasks) },
        ],
      },
      {
        items: [{ id: "trash", label: `Move${count} to Trash`, icon: Trash, shortcut: "⌫", destructive: true, onSelect: () => tasksDo.trash(tasks) }],
      },
    ];
  };

  const trashGroups: (id: string) => MenuGroup[] = (id) => {
    const row = trashRows.find((entry) => entry.id === id);
    if (!row) return [];
    return [
      { items: [{ id: "put-back", label: "Put Back", icon: ArrowUUpLeft, onSelect: () => trashDo.putBack([row]) }] },
      { items: [{ id: "delete", label: "Delete Forever…", icon: Trash, destructive: true, onSelect: () => trashDo.deleteForever(row) }] },
    ];
  };

  const areaGroups: (area: SidebarArea) => MenuGroup[] = (area) => [
    {
      items: [
        { id: "rename", label: "Rename", icon: PencilSimple, onSelect: () => setRenaming({ kind: "area", id: area._id }) },
        {
          id: "colour",
          type: "submenu",
          label: "Colour",
          icon: PaintBrush,
          items: [
            {
              id: "swatches",
              type: "grid",
              label: "Colour",
              columns: 4,
              value: area.colour,
              onValueChange: (colour) => containersDo.setAreaColour(area, colour as AreaColour),
              options: AREA_COLOURS.map((colour) => ({
                value: colour,
                label: colour,
                node: <span className="size-4 rounded-full" style={{ backgroundColor: areaVar(colour) }} />,
              })),
            },
          ],
        },
        {
          id: "icon",
          type: "submenu",
          label: "Icon",
          icon: Shapes,
          items: [],
          groups: [
            {
              items: [
                {
                  id: "icons",
                  type: "grid",
                  label: "Icon",
                  columns: 6,
                  value: area.icon,
                  onValueChange: (icon) => containersDo.setAreaIcon(area, icon),
                  options: (Object.keys(AREA_ICONS) as AreaIconName[]).map((name) => ({
                    value: name,
                    label: AREA_ICONS[name].label,
                    node: <AreaGlyph colour={area.colour} icon={name} />,
                  })),
                },
              ],
            },
            { items: area.icon ? [{ id: "none", label: "No Icon", leading: <AreaDot colour={area.colour} className="size-2.5" />, onSelect: () => containersDo.setAreaIcon(area, null) }] : [] },
          ],
        },
      ],
    },
    {
      items: sidebar
        ? stepItems(areaStepKey(sidebar, area._id, -1), areaStepKey(sidebar, area._id, 1), (order) => containersDo.reorderArea(area, order))
        : [],
    },
    { items: [{ id: "new-project", label: "New Project Here", icon: Plus, onSelect: () => setDraft({ kind: "project", areaId: area._id }) }] },
    { items: [{ id: "trash", label: "Move Area to Trash", icon: Trash, destructive: true, onSelect: () => containersDo.trashArea(area) }] },
  ];

  const projectGroups: (project: SidebarProject, area: SidebarArea | undefined) => MenuGroup[] = (project, area) => [
    {
      items: [
        { id: "rename", label: "Rename", icon: PencilSimple, onSelect: () => setRenaming({ kind: "project", id: project._id }) },
        {
          id: "when",
          type: "submenu",
          label: "When",
          icon: CalendarDots,
          items: [],
          groups: whenItems(undefined, (when) => containersDo.setProjectWhen(project, when, today), false),
        },
        {
          id: "deadline",
          type: "submenu",
          label: "Deadline",
          icon: Flag,
          items: [],
          groups: deadlineItems(undefined, true, (deadline) => containersDo.setProjectDeadline(project, deadline)),
        },
        {
          id: "move",
          type: "submenu",
          label: "Move to Area",
          icon: ArrowBendUpRight,
          items: [],
          groups: [
            { items: [{ id: "none", label: "No Area", icon: FolderSimple, disabled: !area, onSelect: () => containersDo.moveProject(project, null) }] },
            {
              items: areas.map((entry) => ({
                id: entry._id,
                label: entry.title,
                leading: <AreaGlyph colour={entry.colour} icon={entry.icon} />,
                disabled: entry._id === area?._id || isDraftId(entry._id),
                onSelect: () => containersDo.moveProject(project, entry),
              })),
            },
          ],
        },
      ],
    },
    {
      items: sidebar
        ? stepItems(projectStepKey(sidebar, project._id, -1), projectStepKey(sidebar, project._id, 1), (order) =>
            containersDo.reorderProject(project, area?._id ?? null, order),
          )
        : [],
    },
    { items: [{ id: "complete", label: "Complete Project", icon: CheckCircle, onSelect: () => containersDo.completeProject(project, area?._id) }] },
    { items: [{ id: "trash", label: "Move Project to Trash", icon: Trash, destructive: true, onSelect: () => containersDo.trashProject(project, area?._id) }] },
  ];

  const emptyGroups: () => MenuGroup[] = () => [
    {
      items: [
        { id: "new-task", label: "New Task", icon: CheckSquare, shortcut: "N", onSelect: () => newTask({ byKey: false, here: true, at: point }) },
        ...(templatesOn
          ? [
              {
                id: "from-template",
                type: "submenu",
                label: "New Task from Template",
                icon: Stamp,
                disabled: templates.length === 0,
                items: templates.map((template) => ({
                  id: template._id,
                  label: template.title,
                  leading: template.area ? <AreaDot colour={template.area.colour} className="size-2" /> : undefined,
                  disabled: isOptimistic(template._id),
                  onSelect: () => newTask({ byKey: false, template }),
                })),
              } satisfies MenuItem,
            ]
          : []),
        {
          id: "new-project",
          label: "New Project",
          icon: Circle,
          onSelect: () => setDraft({ kind: "project", areaId: route.kind === "area" ? route.id : null }),
        },
        { id: "new-area", label: "New Area", icon: Shapes, onSelect: () => setDraft({ kind: "area" }) },
      ],
    },
    ...(templatesOn
      ? [{ items: [{ id: "templates", label: "Templates", icon: Stamp, onSelect: () => navigate({ kind: "settings", feature: "templates" }, viaKeyboard ? "keyboard" : "pointer") }] }]
      : []),
  ];

  const groupsFor: () => MenuGroup[] = () => {
    if (target.kind === "tasks") return taskGroups(target.key);
    if (target.kind === "trash") return trashGroups(target.id);
    if (target.kind === "occurrence") {
      const row = occurrences?.find((entry) => entry.ruleId === target.ruleId && entry.date === target.date);
      return row ? occurrenceGroups(row) : [];
    }
    if (target.kind === "area") {
      const area = areas.find((entry) => entry._id === target.id);
      return area && !isDraftId(area._id) ? areaGroups(area) : emptyGroups();
    }
    if (target.kind === "project") {
      const area = areas.find((entry) => entry.projects.some((project) => project._id === target.id));
      const project = [...looseProjects, ...(area?.projects ?? [])].find((entry) => entry._id === target.id);
      return project && !isDraftId(project._id) ? projectGroups(project, area) : emptyGroups();
    }
    return emptyGroups();
  };

  return (
    <>
      <ContextMenu
        groups={groupsFor()}
        viaKeyboard={viaKeyboard}
        onOpenChange={(open) => {
          if (open && touched.current) prepare(touched.current.element, touched.current, false);
          touched.current = null;
        }}
      >
        <div
          ref={root}
          className="contents"
          onPointerDownCapture={(event) => {
            const element = event.target;
            const pressed = event.pointerType !== "mouse" && element instanceof Element && root.current?.contains(element) && !isTyping(element);
            touched.current = pressed ? { element, x: event.clientX, y: event.clientY } : null;
          }}
          onContextMenuCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            if (isTyping(event.target)) {
              event.stopPropagation();
              return;
            }
            if (!root.current?.contains(event.target)) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            touched.current = null;
            prepare(event.target, { x: event.clientX, y: event.clientY }, event.detail === 0);
          }}
        >
          {children}
        </div>
      </ContextMenu>
      <PointPopover pick={pointPick} onClose={() => setPointPick(null)} />
    </>
  );
};

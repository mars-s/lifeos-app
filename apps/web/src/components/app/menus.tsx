"use client";

import {
  Archive,
  CalendarDots,
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
  Trash,
  Tray,
  ArrowBendUpRight,
  ArrowSquareOut,
  SelectionAll,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import { AREA_COLOURS, AreaDot, areaVar, type AreaColour } from "@/components/lifeos/area";
import { AREA_ICONS, AreaGlyph, type AreaIconName } from "@/components/lifeos/area-icon";
import { MonthGrid } from "@/components/lifeos/date-pickers";
import { formatMinutes } from "@/components/lifeos/format";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { ContextMenu, type MenuGroup, type MenuItem } from "@/components/ui/action-menu";
import { haptic } from "@/lib/haptics";
import { EASE_OUT, instant } from "@/lib/motion-tokens";
import { useChange } from "./changes";
import { useContainerActions, isDraftId, type SidebarArea, type SidebarProject } from "./container-actions";
import { useView } from "./hooks";
import type { Route } from "./route";
import { selection, useRegisteredTasks, useSelectionSize } from "./selection";
import { useSelectionActions, type MoveTarget } from "./selection-actions";
import { useShell } from "./shell-context";

type Target =
  | { kind: "tasks"; key: string }
  | { kind: "area"; id: string }
  | { kind: "project"; id: string }
  | { kind: "empty" };

type DatePick = { x: number; y: number; tone: "brand" | "deadline"; label: string; value?: string; pick: (date: string) => void };

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180];

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const targetOf: (element: Element) => Target = (element) => {
  const row = element.closest<HTMLElement>("[data-task-key]");
  if (row?.dataset.taskKey) return { kind: "tasks", key: row.dataset.taskKey };
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

const newTaskFor = (route: Route, today: IsoDate) => {
  switch (route.kind) {
    case "today":
      return { when: { kind: "scheduled", date: today, evening: false } } as const;
    case "upcoming":
      return { when: { kind: "scheduled", date: addDays(today, 1), evening: false } } as const;
    case "anytime":
      return { when: { kind: "anytime" } } as const;
    case "someday":
      return { when: { kind: "someday" } } as const;
    case "area":
      return { when: { kind: "anytime" }, parent: { kind: "area", areaId: route.id } } as const;
    case "project":
      return { when: { kind: "anytime" }, parent: { kind: "project", projectId: route.id } } as const;
    default:
      return { when: { kind: "inbox" } } as const;
  }
};

const DatePopover = ({ pick, today, onClose }: { pick: DatePick | null; today: string; onClose: () => void }) => {
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
            <PopoverPrimitive.Content forceMount asChild side="bottom" align="start" sideOffset={4} collisionPadding={12} aria-label={pick.label}>
              <motion.div
                initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
                animate={{ opacity: 1, scale: 1, transition: reduce ? instant : { duration: 0.16, ease: EASE_OUT } }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: reduce ? instant : { duration: 0.1, ease: EASE_OUT } }}
                style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
                className="z-50 w-[17rem] rounded-[1.25rem] bg-popover p-1.5 text-foreground shadow-float outline-none"
              >
                <p className="px-2.5 pt-1.5 text-micro font-medium text-faint-foreground">{pick.label}</p>
                <MonthGrid value={pick.value} today={today} tone={pick.tone} onPick={pick.pick} />
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </AnimatePresence>
    </PopoverPrimitive.Root>
  );
};

const shared = <T,>(tasks: readonly PlannerTask[], read: (task: PlannerTask) => T) => {
  const first = tasks[0] ? JSON.stringify(read(tasks[0])) : undefined;
  return tasks.every((task) => JSON.stringify(read(task)) === first) && tasks[0] ? read(tasks[0]) : undefined;
};

export const AppMenu = ({ sidebar, children }: { sidebar: SidebarView | undefined; children: ReactNode }) => {
  const shell = useShell();
  const { today, route, navigate, setOpenCard, setRenaming, setDraft } = shell;
  const change = useChange();
  const tasksDo = useSelectionActions(today);
  const containersDo = useContainerActions(shell);
  const labels = useView(api.planner.labels.list, {}) ?? [];
  const root = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target>({ kind: "empty" });
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const [datePick, setDatePick] = useState<DatePick | null>(null);
  useRegisteredTasks();
  useSelectionSize();

  const newTask = useMemo(
    () => () => {
      const context = newTaskFor(route, today);
      if (route.kind === "logbook" || route.kind === "missing") navigate({ kind: "inbox" }, "keyboard");
      void change({
        title: "Task created",
        mutation: api.planner.tasks.create,
        args: { title: "New Task", ...context },
        apply: () => undefined,
        revert: () => undefined,
        onSaved: ({ taskId }) => {
          selection.clear();
          setOpenCard({ key: taskId, instant: false });
        },
      });
    },
    [change, navigate, route, setOpenCard, today],
  );

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
      if (command && !event.shiftKey && event.key.toLowerCase() === "k" && chosen.length > 0) {
        event.preventDefault();
        tasksDo.completeSoon(chosen);
        return;
      }
      if (!command && !event.shiftKey && (event.key === "Backspace" || event.key === "Delete") && chosen.length > 0) {
        event.preventDefault();
        tasksDo.trash(chosen);
        return;
      }
      if (!command && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newTask();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newTask, tasksDo]);

  const areas = sidebar?.areas ?? [];
  const looseProjects = sidebar?.projects ?? [];

  const pickDate = (label: string, tone: DatePick["tone"], value: string | undefined, pick: (date: string) => void) =>
    setTimeout(() => setDatePick({ ...point, label, tone, value, pick }), 0);

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
        ],
      },
      {
        items: [
          closed
            ? { id: "reopen", label: `Reopen${count}`, icon: Circle, onSelect: () => tasksDo.reopen(tasks) }
            : { id: "complete", label: `Complete${count}`, icon: CheckCircle, shortcut: "⌘K", onSelect: () => tasksDo.completeSoon(tasks) },
        ],
      },
      {
        items: [{ id: "trash", label: `Move${count} to Trash`, icon: Trash, shortcut: "⌫", destructive: true, onSelect: () => tasksDo.trash(tasks) }],
      },
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
    { items: [{ id: "complete", label: "Complete Project", icon: CheckCircle, onSelect: () => containersDo.completeProject(project, area?._id) }] },
    { items: [{ id: "trash", label: "Move Project to Trash", icon: Trash, destructive: true, onSelect: () => containersDo.trashProject(project, area?._id) }] },
  ];

  const emptyGroups: () => MenuGroup[] = () => [
    {
      items: [
        { id: "new-task", label: "New Task", icon: CheckSquare, shortcut: "N", onSelect: newTask },
        {
          id: "new-project",
          label: "New Project",
          icon: Circle,
          onSelect: () => setDraft({ kind: "project", areaId: route.kind === "area" ? route.id : null }),
        },
        { id: "new-area", label: "New Area", icon: Shapes, onSelect: () => setDraft({ kind: "area" }) },
      ],
    },
  ];

  const groupsFor: () => MenuGroup[] = () => {
    if (target.kind === "tasks") return taskGroups(target.key);
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
      <ContextMenu groups={groupsFor()} viaKeyboard={viaKeyboard}>
        <div
          ref={root}
          className="contents"
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
            const next = targetOf(event.target);
            if (next.kind === "tasks" && !selection.has(next.key)) selection.only(next.key);
            if (next.kind !== "tasks" && !event.target.closest("[data-selection-bar]")) selection.clear();
            setTarget(next.kind === "empty" && event.target.closest("[data-selection-bar]") ? { kind: "tasks", key: selection.keys()[0] ?? "" } : next);
            setPoint({ x: event.clientX, y: event.clientY });
            setViaKeyboard(event.detail === 0);
            haptic("snap");
          }}
        >
          {children}
        </div>
      </ContextMenu>
      <DatePopover pick={datePick} today={today} onClose={() => setDatePick(null)} />
    </>
  );
};

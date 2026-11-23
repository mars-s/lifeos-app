"use client";

import { DndContext, MouseSensor, closestCenter, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, CalendarDots, CheckSquare, GearSix, Kanban, Plus, Shapes, Stack, Star, Trash, Tray, type Icon } from "@phosphor-icons/react";
import { generateKeyBetween } from "fractional-indexing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SidebarView } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { LifeosMark } from "@/components/lifeos/mark";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { Popover } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { haptic } from "@/lib/haptics";
import { enter, exit, instant, spring } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import {
  areaStepKey,
  isDraftId,
  projectHome,
  projectStepKey,
  useContainerActions,
  type ContainerActions,
  type SidebarArea,
} from "./container-actions";
import { Folding } from "./fold";
import { RouteLink } from "./list-page";
import { sameRoute, type ListKind, type Route, type Via } from "./route";
import { useNeedsAttention } from "./settings/attention";
import { useShell, type Renaming } from "./shell-context";

export const LIST_META = {
  inbox: { label: "Inbox", icon: Tray },
  today: { label: "Today", icon: Star },
  upcoming: { label: "Upcoming", icon: CalendarDots },
  anytime: { label: "Anytime", icon: Stack },
  someday: { label: "Someday", icon: Archive },
  logbook: { label: "Logbook", icon: CheckSquare },
  trash: { label: "Trash", icon: Trash },
} as const satisfies Record<ListKind, { label: string; icon: Icon }>;

export const PLANNER_META = { label: "Planner", icon: Kanban } as const;

export const SETTINGS_META = { label: "Settings", icon: GearSix } as const;

const rowClass = (indent: boolean) =>
  cn(
    "relative flex h-8 items-center gap-2.5 rounded-lg pr-2.5 text-small outline-offset-[-2px] transition-[color,scale] duration-(--dur-press) ease-out max-md:h-10",
    indent ? "pl-7" : "pl-2.5",
  );

const TitleInput = ({
  initial,
  placeholder,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  label: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) => {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      field.current?.focus({ preventScroll: true });
      field.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const title = field.current?.value.trim() ?? "";
    if (commit && title && title !== initial) onCommit(title);
    else onCancel();
  };
  return (
    <input
      ref={field}
      aria-label={label}
      name="title"
      defaultValue={initial}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") settle(true);
        if (event.key === "Escape") settle(false);
      }}
      className="relative min-w-0 flex-1 rounded-sm bg-transparent font-medium outline-none select-text placeholder:font-normal placeholder:text-faint-foreground"
    />
  );
};

const NavItem = ({
  to,
  label,
  icon: IconComponent,
  leading,
  count,
  trailing,
  indent = false,
  quiet = false,
  via,
  menu,
  rename,
}: {
  to: Route;
  label: string;
  icon?: Icon;
  leading?: ReactNode;
  count?: number;
  trailing?: ReactNode;
  indent?: boolean;
  quiet?: boolean;
  via: Via;
  menu?: { "data-menu-area": string } | { "data-menu-project": string };
  rename?: { target: Renaming; save: (title: string) => void };
}) => {
  const { route, renaming, setRenaming } = useShell();
  const reduce = useReducedMotion();
  const active = sameRoute(route, to);
  const editing = rename !== undefined && renaming?.id === rename.target.id;
  const glyph = (
    <span className={cn("relative grid size-4 shrink-0 place-items-center", active ? "text-brand" : "text-muted-foreground")}>
      {IconComponent ? <IconComponent weight="fill" className="size-4" aria-hidden="true" /> : leading}
    </span>
  );
  if (editing)
    return (
      <div {...menu} className={cn(rowClass(indent), "bg-foreground/[0.05] shadow-[inset_0_0_0_1px_var(--border)]")}>
        {glyph}
        <TitleInput
          initial={label}
          placeholder={label}
          label={`Rename ${label}`}
          onCommit={(title) => {
            rename.save(title);
            setRenaming(null);
          }}
          onCancel={() => setRenaming(null)}
        />
      </div>
    );
  return (
    <RouteLink
      to={to}
      {...menu}
      data-arrow-item
      draggable={false}
      aria-current={active ? "page" : undefined}
      onDoubleClick={rename ? () => setRenaming(rename.target) : undefined}
      className={cn(
        rowClass(indent),
        "active:scale-[0.985]",
        active ? "font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
        quiet && !active && "text-muted-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-selection"
          transition={reduce || via === "keyboard" ? instant : spring}
          className="absolute inset-0 rounded-lg bg-foreground/[0.08]"
        />
      )}
      {glyph}
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      <AnimatePresence initial={false}>
        {count !== undefined && count > 0 && (
          <motion.span key="count" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: enter }} exit={{ opacity: 0, transition: exit }} className="relative">
            <span className="sr-only">, </span>
            <RollingNumber value={count} className="font-mono text-micro text-faint-foreground" />
          </motion.span>
        )}
      </AnimatePresence>
      {trailing}
    </RouteLink>
  );
};

const Leaving = ({ id, className, children }: { id: string; className?: string; children: ReactNode }) =>
  isDraftId(id) ? (
    <div className={className}>{children}</div>
  ) : (
    <Folding appear={false} className="mx-0 px-0">
      <div className={className}>{children}</div>
    </Folding>
  );

const DraftRow = ({ kind, indent, onCommit }: { kind: "area" | "project"; indent: boolean; onCommit: (title: string) => void }) => {
  const { setDraft } = useShell();
  const name = kind === "area" ? "New Area" : "New Project";
  return (
    <div className={cn(rowClass(indent), "bg-foreground/[0.05] shadow-[inset_0_0_0_1px_var(--border)]")}>
      <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
        {kind === "area" ? <span className="size-2.5 rounded-full bg-foreground/25" /> : <ProgressPie value={0} colour="var(--muted-foreground)" />}
      </span>
      <TitleInput
        initial=""
        placeholder={name}
        label={`${name} title`}
        onCommit={(title) => {
          onCommit(title);
          setDraft(null);
        }}
        onCancel={() => setDraft(null)}
      />
    </div>
  );
};

const ProjectItem = ({
  project,
  colour,
  indent,
  via,
  actions,
}: {
  project: SidebarView["projects"][number];
  colour: string;
  indent: boolean;
  via: Via;
  actions: ContainerActions;
}) => {
  const reduce = useReducedMotion();
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    transition: reduce ? null : undefined,
    id: project._id,
    data: { kind: "project" },
    disabled: isDraftId(project._id),
  });
  return (
  <div
    ref={setNodeRef}
    {...listeners}
    style={{ transform: CSS.Translate.toString(transform), transition }}
    className={cn("relative rounded-lg", isDragging && "z-20 bg-surface shadow-lift")}
  >
  <NavItem
    to={{ kind: "project", id: project._id }}
    label={project.title}
    indent={indent}
    quiet={project.someday}
    via={via}
    menu={{ "data-menu-project": project._id }}
    rename={
      isDraftId(project._id)
        ? undefined
        : { target: { kind: "project", id: project._id }, save: (title) => actions.renameProject(project, title) }
    }
    leading={
      <ProgressPie
        value={project.progress.total === 0 ? 0 : project.progress.done / project.progress.total}
        colour={colour}
        className={cn(project.someday && "opacity-50")}
      />
    }
  />
  </div>
  );
};

const AreaGroup = ({ area, via, actions }: { area: SidebarArea; via: Via; actions: ContainerActions }) => {
  const { draft } = useShell();
  const reduce = useReducedMotion();
  const { setNodeRef, listeners, transform, transition, isDragging, isOver, active } = useSortable({
    transition: reduce ? null : undefined,
    id: area._id,
    data: { kind: "area" },
    disabled: isDraftId(area._id),
  });
  const receiving = isOver && active?.data.current?.kind === "project" && !area.projects.some((project) => project._id === active.id);
  return (
    <div
      ref={setNodeRef}
      data-menu-area={area._id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative rounded-lg transition-[background-color] duration-(--dur-fast) ease-out",
        isDragging && "z-10 bg-surface shadow-lift",
        receiving && "bg-foreground/[0.06]",
      )}
    >
      <div {...listeners}>
        <NavItem
          to={{ kind: "area", id: area._id }}
          label={area.title}
          leading={<AreaGlyph colour={area.colour} icon={area.icon} />}
          via={via}
          rename={
            isDraftId(area._id) ? undefined : { target: { kind: "area", id: area._id }, save: (title) => actions.renameArea(area, title) }
          }
        />
      </div>
      <SortableContext items={area.projects.map((project) => project._id)} strategy={verticalListSortingStrategy}>
        <AnimatePresence initial={false}>
          {area.projects.map((project) => (
            <Leaving key={project._id} id={project._id}>
              <ProjectItem project={project} colour={areaVar(area.colour)} indent via={via} actions={actions} />
            </Leaving>
          ))}
        </AnimatePresence>
      </SortableContext>
      {draft?.kind === "project" && draft.areaId === area._id && (
        <DraftRow kind="project" indent onCommit={(title) => actions.createProject(title, area._id)} />
      )}
    </div>
  );
};

const NEW_LIST = [
  {
    kind: "project",
    title: "New Project",
    hint: "A goal that finishes. Work towards it one Task at a time.",
  },
  {
    kind: "area",
    title: "New Area",
    hint: "An ongoing responsibility, such as University or Home. It groups Projects and Tasks.",
  },
] as const;

const NewList = () => {
  const { route, setDraft } = useShell();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      className="w-[17.5rem] p-1.5"
      trigger={
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full pr-3 pl-2 text-small text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.97] aria-expanded:bg-foreground/[0.06] aria-expanded:text-foreground max-md:h-10"
        >
          <Plus weight="bold" className="size-3.5" aria-hidden="true" />
          New List
        </button>
      }
    >
      {NEW_LIST.map(({ kind, title, hint }) => (
        <button
          key={kind}
          type="button"
          onClick={() => {
            setOpen(false);
            setDraft(kind === "area" ? { kind } : { kind, areaId: route.kind === "area" ? route.id : null });
          }}
          className="flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors duration-(--dur-press) hover:bg-foreground/[0.06]"
        >
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
            {kind === "project" ? <ProgressPie value={0.3} colour="var(--brand)" /> : <Shapes weight="fill" className="size-4 text-area-teal" aria-hidden="true" />}
          </span>
          <span className="min-w-0">
            <span className="block text-small font-medium">{title}</span>
            <span className="block text-small text-pretty text-muted-foreground">{hint}</span>
          </span>
        </button>
      ))}
    </Popover>
  );
};

const SettingsItem = ({ via }: { via: Via }) => {
  const { today } = useShell();
  const attention = useNeedsAttention(today);
  return (
    <NavItem
      to={{ kind: "settings" }}
      {...SETTINGS_META}
      via={via}
      trailing={
        attention && (
          <span className="relative flex items-center" title="Something in Settings needs a look">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-negative" />
            <span className="sr-only">, needs attention</span>
          </span>
        )
      }
    />
  );
};

const DRAG_START_PX = 6;
const DRAG_MODIFIERS = [restrictToVerticalAxis];

const kindOf = (entry: { data: { current?: Record<string, unknown> } }) => entry.data.current?.kind;

const sameKindFirst: CollisionDetection = (args) => {
  const kind = kindOf(args.active);
  const same = args.droppableContainers.filter((container) => kindOf(container) === kind);
  const hits = closestCenter({ ...args, droppableContainers: kind === "area" ? same : args.droppableContainers });
  return hits;
};

const between = <T extends { _id: string; order: string }>(siblings: readonly T[], movedId: string, overId: string) => {
  const to = siblings.findIndex((entry) => entry._id === overId);
  const others = siblings.filter((entry) => entry._id !== movedId);
  return to === -1 ? null : generateKeyBetween(others[to - 1]?.order ?? null, others[to]?.order ?? null);
};

const Sortables = ({ view, actions, children }: { view: SidebarView; actions: ContainerActions; children: ReactNode }) => {
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: DRAG_START_PX } }));
  const dragged = useRef(false);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragged.current = true;
    setTimeout(() => (dragged.current = false), 0);
    if (!over || active.id === over.id) return;
    const movedId = String(active.id);
    const overId = String(over.id);
    if (kindOf(active) === "area") {
      const moved = view.areas.find((area) => area._id === movedId);
      const order = between(view.areas, movedId, overId);
      if (!moved || !order) return;
      haptic("drop");
      return actions.reorderArea(moved, order);
    }
    const from = projectHome(view, movedId);
    if (!from) return;
    const overArea = view.areas.find((area) => area._id === overId);
    if (overArea) {
      if (overArea._id === from.area?._id) return;
      haptic("drop");
      return actions.moveProject(from.project, overArea);
    }
    const to = projectHome(view, overId);
    if (!to) return;
    const order =
      to.area?._id === from.area?._id
        ? between(to.siblings, movedId, overId)
        : generateKeyBetween(to.siblings[to.siblings.indexOf(to.project) - 1]?.order ?? null, to.project.order);
    if (!order) return;
    haptic("drop");
    if (to.area?._id === from.area?._id) actions.reorderProject(from.project, from.area?._id ?? null, order);
    else actions.moveProject(from.project, to.area ?? null, order);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={sameKindFirst} modifiers={DRAG_MODIFIERS} onDragEnd={onDragEnd}>
      <div
        className="contents"
        onClickCapture={(event) => {
          if (!dragged.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (step === 0 || !(event.metaKey || event.ctrlKey) || !(event.target instanceof HTMLElement)) return;
          const projectId = event.target.dataset.menuProject;
          const areaId = event.target.closest<HTMLElement>("[data-menu-area]")?.dataset.menuArea;
          if (projectId) {
            const home = projectHome(view, projectId);
            const order = projectStepKey(view, projectId, step);
            if (home && order) actions.reorderProject(home.project, home.area?._id ?? null, order);
          } else if (areaId) {
            const area = view.areas.find((entry) => entry._id === areaId);
            const order = areaStepKey(view, areaId, step);
            if (area && order) actions.reorderArea(area, order);
          } else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </DndContext>
  );
};

const Areas = ({ areas, via, actions }: { areas: SidebarArea[]; via: Via; actions: ContainerActions }) => (
  <SortableContext items={areas.map((area) => area._id)} strategy={verticalListSortingStrategy}>
    <div className="-mt-4 flex flex-col">
      <AnimatePresence initial={false}>
        {areas.map((area) => (
          <Leaving key={area._id} id={area._id} className="pt-4">
            <AreaGroup area={area} via={via} actions={actions} />
          </Leaving>
        ))}
      </AnimatePresence>
    </div>
  </SortableContext>
);

export const Sidebar = ({ view, via, notice }: { view: SidebarView | undefined; via: Via; notice?: ReactNode }) => {
  const shell = useShell();
  const actions = useContainerActions(shell);
  const { draft } = shell;
  const looseDraft = draft?.kind === "project" && draft.areaId === null;
  return (
    <nav aria-label="Lists" data-arrow-scope className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-2">
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-end px-2.5 pb-1">
        <span className="flex items-center gap-2 text-small font-semibold md:hidden">
          <LifeosMark fill="enter" />
          <span translate="no">LifeOS</span>
        </span>
      </div>
      <div>
        <NavItem to={{ kind: "inbox" }} {...LIST_META.inbox} count={view?.counts.inbox} via={via} />
      </div>
      <div>
        <NavItem to={{ kind: "today" }} {...LIST_META.today} count={view?.counts.today} via={via} />
        <NavItem to={{ kind: shell.route.kind === "upcoming" ? "upcoming" : "planner" }} {...PLANNER_META} via={via} />
        <NavItem to={{ kind: "anytime" }} {...LIST_META.anytime} via={via} />
        <NavItem to={{ kind: "someday" }} {...LIST_META.someday} via={via} />
      </div>
      <div>
        <NavItem to={{ kind: "logbook" }} {...LIST_META.logbook} via={via} />
        <NavItem to={{ kind: "trash" }} {...LIST_META.trash} via={via} />
      </div>
      {notice}
      {view && (
        <Sortables view={view} actions={actions}>
          {(view.projects.length > 0 || looseDraft) && (
            <div>
              <SortableContext items={view.projects.map((project) => project._id)} strategy={verticalListSortingStrategy}>
                <AnimatePresence initial={false}>
                  {view.projects.map((project) => (
                    <Leaving key={project._id} id={project._id}>
                      <ProjectItem project={project} colour="var(--muted-foreground)" indent={false} via={via} actions={actions} />
                    </Leaving>
                  ))}
                </AnimatePresence>
              </SortableContext>
              {looseDraft && <DraftRow kind="project" indent={false} onCommit={(title) => actions.createProject(title, null)} />}
            </div>
          )}
          <Areas areas={view.areas} via={via} actions={actions} />
        </Sortables>
      )}
      {draft?.kind === "area" && <DraftRow kind="area" indent={false} onCommit={(title) => actions.createArea(title, view)} />}
      <div className="mt-auto pt-2">
        <NewList />
        <SettingsItem via={via} />
      </div>
    </nav>
  );
};

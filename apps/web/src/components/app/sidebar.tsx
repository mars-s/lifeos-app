"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, CalendarDots, CheckSquare, Plus, Shapes, SignOut, Stack, Star, Tray, type Icon } from "@phosphor-icons/react";
import { generateKeyBetween } from "fractional-indexing";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { SidebarView } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { LifeosMark } from "@/components/lifeos/mark";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { MorphText } from "@/components/ui/morph-text";
import { Popover } from "@/components/ui/popover-panel";
import { RollingNumber } from "@/components/ui/rolling-number";
import { haptic } from "@/lib/haptics";
import { instant, spring } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { isDraftId, useContainerActions, type ContainerActions, type SidebarArea } from "./container-actions";
import { timeAgo } from "./dates";
import { useNow, useView } from "./hooks";
import { RouteLink } from "./list-page";
import { sameRoute, type ListKind, type Route, type Via } from "./route";
import { useShell, type Renaming } from "./shell-context";

export const LIST_META = {
  inbox: { label: "Inbox", icon: Tray },
  today: { label: "Today", icon: Star },
  upcoming: { label: "Upcoming", icon: CalendarDots },
  anytime: { label: "Anytime", icon: Stack },
  someday: { label: "Someday", icon: Archive },
  logbook: { label: "Logbook", icon: CheckSquare },
} as const satisfies Record<ListKind, { label: string; icon: Icon }>;

const STALE_AFTER_MS = 10 * 60_000;

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
      {count !== undefined && count > 0 && (
        <>
          <span className="sr-only">, </span>
          <RollingNumber value={count} className="relative font-mono text-micro text-faint-foreground" />
        </>
      )}
    </RouteLink>
  );
};

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
}) => (
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
);

const AreaGroup = ({ area, via, actions }: { area: SidebarArea; via: Via; actions: ContainerActions }) => {
  const { draft } = useShell();
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: area._id, disabled: isDraftId(area._id) });
  return (
    <div
      ref={setNodeRef}
      data-menu-area={area._id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative rounded-lg", isDragging && "z-10 bg-surface shadow-lift")}
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
      {area.projects.map((project) => (
        <ProjectItem key={project._id} project={project} colour={areaVar(area.colour)} indent via={via} actions={actions} />
      ))}
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

const SyncIndicator = () => {
  const status = useView(api.planner.things.status, {});
  const now = useNow();
  if (status === undefined || now === null || status?.retiredAt !== undefined) return <p className="h-8 flex-1" />;
  const fresh = status !== null && now - status.syncedAt < STALE_AFTER_MS;
  return (
    <p
      className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-2.5 text-micro text-faint-foreground"
      title={status ? new Date(status.syncedAt).toLocaleString("en-AU") : undefined}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", fresh ? "bg-positive" : "bg-foreground/25")} />
      <MorphText>{status ? `Synced from Things ${timeAgo(status.syncedAt, Math.max(now, status.syncedAt))}` : "Not synced from Things yet"}</MorphText>
    </p>
  );
};

const SignOutButton = () => {
  const { signOut } = useAuthActions();
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      onClick={() => void signOut()}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.94]"
    >
      <SignOut className="size-4" aria-hidden="true" />
    </button>
  );
};

const DRAG_START_PX = 6;

const Areas = ({ areas, via, actions }: { areas: SidebarArea[]; via: Via; actions: ContainerActions }) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: DRAG_START_PX } }));
  const dragged = useRef(false);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    dragged.current = true;
    setTimeout(() => (dragged.current = false), 0);
    if (!over || active.id === over.id) return;
    const from = areas.findIndex((area) => area._id === active.id);
    const to = areas.findIndex((area) => area._id === over.id);
    const moved = areas[from];
    if (!moved || to === -1) return;
    const rest = areas.filter((area) => area._id !== moved._id);
    haptic("drop");
    actions.reorderArea(moved, generateKeyBetween(rest[to - 1]?.order ?? null, rest[to]?.order ?? null));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
      <SortableContext items={areas.map((area) => area._id)} strategy={verticalListSortingStrategy}>
        <div
          className="flex flex-col gap-4"
          onClickCapture={(event) => {
            if (!dragged.current) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {areas.map((area) => (
            <AreaGroup key={area._id} area={area} via={via} actions={actions} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

export const Sidebar = ({ view, via }: { view: SidebarView | undefined; via: Via }) => {
  const shell = useShell();
  const actions = useContainerActions(shell);
  const { draft } = shell;
  const looseDraft = draft?.kind === "project" && draft.areaId === null;
  return (
    <nav aria-label="Lists" data-arrow-scope className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-2">
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-end px-2.5 pb-1">
        <span className="flex items-center gap-2 text-small font-semibold md:hidden">
          <LifeosMark fill="enter" />
          LifeOS
        </span>
      </div>
      <div>
        <NavItem to={{ kind: "inbox" }} {...LIST_META.inbox} count={view?.counts.inbox} via={via} />
      </div>
      <div>
        <NavItem to={{ kind: "today" }} {...LIST_META.today} count={view?.counts.today} via={via} />
        <NavItem to={{ kind: "upcoming" }} {...LIST_META.upcoming} via={via} />
        <NavItem to={{ kind: "anytime" }} {...LIST_META.anytime} via={via} />
        <NavItem to={{ kind: "someday" }} {...LIST_META.someday} via={via} />
      </div>
      <div>
        <NavItem to={{ kind: "logbook" }} {...LIST_META.logbook} via={via} />
      </div>
      {view && (view.projects.length > 0 || looseDraft) && (
        <div>
          {view.projects.map((project) => (
            <ProjectItem key={project._id} project={project} colour="var(--muted-foreground)" indent={false} via={via} actions={actions} />
          ))}
          {looseDraft && <DraftRow kind="project" indent={false} onCommit={(title) => actions.createProject(title, null)} />}
        </div>
      )}
      {view && <Areas areas={view.areas} via={via} actions={actions} />}
      {draft?.kind === "area" && <DraftRow kind="area" indent={false} onCommit={(title) => actions.createArea(title, view)} />}
      <div className="mt-auto pt-2">
        <NewList />
        <div className="flex items-center">
          <SyncIndicator />
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
};

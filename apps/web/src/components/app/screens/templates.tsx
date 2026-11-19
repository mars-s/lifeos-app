"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, DotsSixVertical, DotsThree, Flag, FolderSimple, ListChecks, Stamp, Trash, Tray, X } from "@phosphor-icons/react";
import { generateKeyBetween } from "fractional-indexing";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask, SidebarView, TemplateRow } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { EstimateField } from "@/components/lifeos/estimate-field";
import { LabelPicker } from "@/components/lifeos/label-picker";
import { Stepper } from "@/components/lifeos/repeat-picker";
import { EmptyState } from "@/components/lifeos/states";
import { EstimateChip } from "@/components/lifeos/task-row";
import { MenuRow, ToolButton } from "@/components/lifeos/tool-button";
import { formatMinutes } from "@/components/lifeos/format";
import { Menu } from "@/components/ui/action-menu";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { both, patchLabelColour, patchLabelList, useChange } from "../changes";
import { useQuietView, useView } from "../hooks";
import { ListSkeleton } from "../list-page";
import { useShell } from "../shell-context";
import { NotesField } from "../task-card-body";
import { isOptimistic } from "../task-actions";
import { useFeatures } from "../settings/feature-state";
import { editTemplates, useTemplateActions } from "../template-actions";

type Label = PlannerTask["labels"][number];
type Home = Pick<TemplateRow, "parent" | "area" | "project">;

const OFFSETS = [1, 3, 7, 14, 30] as const;
const MAX_OFFSET_DAYS = 365;
const OUTSIDE = "[data-radix-popper-content-wrapper], [data-toaster], [role=menu]";

const offsetLabel = (days: number) => (days === 0 ? "Due on its day" : `Due ${days} ${days === 1 ? "day" : "days"} later`);

const withField = <K extends "estimateMinutes" | "deadlineOffsetDays">(key: K, value: number | null) => (row: TemplateRow) => {
  const { [key]: _previous, ...rest } = row;
  return value === null ? rest : { ...rest, [key]: value };
};

const homesFrom = (sidebar: SidebarView | undefined) => {
  const loose = { parent: { kind: "loose" } } satisfies Home;
  const project = (entry: SidebarView["projects"][number], area?: SidebarView["areas"][number]) =>
    ({
      parent: { kind: "project", projectId: entry._id },
      project: { _id: entry._id, title: entry.title },
      ...(area ? { area: { _id: area._id, title: area.title, colour: area.colour, icon: area.icon } } : {}),
    }) satisfies Home;
  return [
    { id: "loose", label: "No Area or Project", indent: false, home: loose as Home },
    ...(sidebar?.projects ?? []).map((entry) => ({ id: entry._id, label: entry.title, indent: false, home: project(entry) as Home })),
    ...(sidebar?.areas ?? []).flatMap((area) => [
      {
        id: area._id,
        label: area.title,
        indent: false,
        colour: area.colour,
        home: {
          parent: { kind: "area", areaId: area._id },
          area: { _id: area._id, title: area.title, colour: area.colour, icon: area.icon },
        } as Home,
      },
      ...area.projects.map((entry) => ({ id: entry._id, label: entry.title, indent: true, home: project(entry, area) as Home })),
    ]),
  ];
};

const homeId = (row: Home) => (row.parent.kind === "project" ? row.parent.projectId : row.parent.kind === "area" ? row.parent.areaId : "loose");

const HomePicker = ({ template, sidebar, onPick }: { template: TemplateRow; sidebar: SidebarView | undefined; onPick: (home: Home) => void }) => {
  const label = template.project?.title ?? template.area?.title;
  const current = homeId(template);
  return (
    <Popover
      align="start"
      className="max-h-(--radix-popover-content-available-height) w-64 overflow-y-auto overscroll-contain p-1.5"
      trigger={
        <button
          type="button"
          aria-label={`Area or Project: ${label ?? "none"}`}
          className="inline-flex h-7 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 text-small text-foreground/80 transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97] aria-expanded:bg-foreground/[0.1]"
        >
          {template.area ? (
            <AreaDot colour={template.area.colour} className="size-1.5" />
          ) : (
            <Tray weight="fill" className="size-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate">{label ?? "No Area or Project"}</span>
        </button>
      }
    >
      {homesFrom(sidebar).map((entry) => (
        <PopoverClose key={entry.id} asChild>
          <MenuRow selected={entry.id === current} className={cn(entry.indent && "pl-7")} onClick={() => entry.id !== current && onPick(entry.home)}>
            {"colour" in entry && entry.colour ? (
              <AreaDot colour={entry.colour} className="size-2" />
            ) : (
              <FolderSimple weight="fill" className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate">{entry.label}</span>
          </MenuRow>
        </PopoverClose>
      ))}
    </Popover>
  );
};

const DeadlineOffset = ({ days, onChange }: { days: number | undefined; onChange: (days: number | null) => void }) => (
  <Popover
    align="end"
    title="Deadline"
    className="w-[17rem] p-3"
    trigger={
      days === undefined ? (
        <ToolButton icon={Flag} label="Deadline" />
      ) : (
        <ToolButton icon={Flag} label={`Deadline: ${offsetLabel(days)}`} active className="pr-2.5 text-deadline">
          <span className="pl-1.5 font-medium">{offsetLabel(days)}</span>
        </ToolButton>
      )
    }
  >
    <p className="pl-1 text-small text-pretty text-muted-foreground">Each new Task gets a Deadline this many days after its When.</p>
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {OFFSETS.map((offset) => (
        <button
          key={offset}
          type="button"
          aria-pressed={offset === days}
          onClick={() => onChange(offset)}
          className={cn(
            "h-7 rounded-full px-2.5 font-mono text-small tabular-nums transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.96]",
            offset === days ? "bg-deadline text-background" : "bg-foreground/[0.05] hover:bg-foreground/[0.09]",
          )}
        >
          {offset}d
        </button>
      ))}
    </div>
    <div className="mt-2.5 flex items-center gap-2 text-small">
      <Stepper value={days ?? 7} min={0} max={MAX_OFFSET_DAYS} label="Days after its When" onChange={onChange} />
      <span className="text-muted-foreground">days after its When</span>
    </div>
    {days !== undefined && (
      <>
        <div className="my-2 border-t border-border" />
        <PopoverClose asChild>
          <MenuRow onClick={() => onChange(null)}>
            <Flag className="size-4 text-muted-foreground" aria-hidden="true" />
            No Deadline
          </MenuRow>
        </PopoverClose>
      </>
    )}
  </Popover>
);

const ChecklistLine = ({ title, onCommit, onRemove }: { title: string; onCommit: (title: string) => void; onRemove: () => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <li className="group/item flex min-h-8 items-center gap-2.5 rounded-lg px-2 transition-[background-color] duration-(--dur-fast) ease-out focus-within:bg-foreground/[0.05]">
      <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-[1.5px] border-foreground/25" />
      <input
        aria-label="Checklist Item"
        name="checklist-item"
        autoComplete="off"
        value={draft ?? title}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft?.trim();
          setDraft(null);
          if (next === "") onRemove();
          else if (next && next !== title) onCommit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-transparent text-small outline-none"
      />
      <button
        type="button"
        aria-label={`Remove ${title}`}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded-full text-faint-foreground opacity-0 transition-[opacity,background-color,color] duration-(--dur-fast) ease-out group-focus-within/item:opacity-100 group-hover/item:opacity-100 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X weight="bold" className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
};

const TemplateChecklist = ({ items, onChange }: { items: readonly string[]; onChange: (items: string[]) => void }) => {
  const [text, setText] = useState("");
  return (
    <ul aria-label="Checklist" className="-ml-2 rounded-xl bg-foreground/[0.035] p-1">
      {items.map((title, index) => (
        <ChecklistLine
          key={`${index}:${title}`}
          title={title}
          onCommit={(next) => onChange(items.with(index, next))}
          onRemove={() => onChange(items.toSpliced(index, 1))}
        />
      ))}
      <li className="flex min-h-8 items-center gap-2.5 rounded-lg px-2 transition-[background-color] duration-(--dur-fast) ease-out focus-within:bg-foreground/[0.05]">
        <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-foreground/20" />
        <input
          aria-label="Add a Checklist Item"
          name="new-checklist-item"
          autoComplete="off"
          placeholder="Add a Checklist Item…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            const title = text.trim();
            if (event.key !== "Enter" || title === "") return;
            onChange([...items, title]);
            setText("");
          }}
          className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint-foreground"
        />
      </li>
    </ul>
  );
};

const TitleInput = ({ title, onCommit }: { title: string; onCommit: (title: string) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  return (
    <input
      ref={field}
      aria-label="Title"
      name="title"
      autoComplete="off"
      value={draft ?? title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft?.trim();
        setDraft(null);
        if (next && next !== title) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="block min-w-0 flex-1 bg-transparent font-medium outline-none"
    />
  );
};

const TemplateEditor = ({ template, labels, sidebar }: { template: TemplateRow; labels: readonly Label[]; sidebar: SidebarView | undefined }) => {
  const actions = useTemplateActions();
  const change = useChange();
  const edit = actions.edit.bind(null, template);
  const showLabels = (next: Label[]) => (row: TemplateRow) => ({ ...row, labels: next, labelIds: next.map((label) => label._id) });
  const setLabels = (next: Label[]) => edit("Labels changed", { labelIds: next.map((label) => label._id) }, showLabels(next));
  const createLabel = (name: string, colour: Label["colour"]) => {
    const created = { _id: `optimistic:${name}` as Label["_id"], name, colour };
    const onTemplate = (next: Label[]) => editTemplates((rows) => rows.map((row) => (row._id === template._id ? showLabels(next)(row) : row)));
    void change({
      title: `Made the Label ${name}`,
      mutation: api.planner.labels.create,
      args: { name, colour },
      apply: both(patchLabelList((list) => [...list, created]), onTemplate([...template.labels, created])),
      revert: both(patchLabelList((list) => list.filter((label) => label.name !== name)), onTemplate(template.labels)),
      onSaved: ({ labelId }) => setLabels([...template.labels, { ...created, _id: labelId }]),
    });
  };
  const recolourLabel = (labelId: string, colour: Label["colour"]) => {
    const label = labels.find((entry) => entry._id === labelId);
    if (!label || isOptimistic(label._id)) return;
    void change({
      title: `${label.name} is now ${colour}`,
      mutation: api.planner.labels.setColour,
      args: { labelId: label._id, colour },
      apply: patchLabelColour(label._id, colour),
      revert: patchLabelColour(label._id, label.colour),
    });
  };
  return (
    <div className="space-y-3 pt-1 pr-3 pb-3 pl-[2.625rem]">
      <NotesField notes={template.notes} onSave={(notes) => edit("Notes changed", { notes }, (row) => ({ ...row, notes }))} />
      <TemplateChecklist
        items={template.checklist}
        onChange={(checklist) =>
          edit("Checklist changed", { checklist }, (row) => ({ ...row, checklist, checklistCount: checklist.length }))
        }
      />
      <EstimateField
        minutes={template.estimateMinutes}
        onChange={(minutes) =>
          edit(minutes === null ? "Estimate cleared" : `Estimate set to ${formatMinutes(minutes)}`, { estimateMinutes: minutes }, withField("estimateMinutes", minutes))
        }
      />
      <div className="-ml-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <HomePicker
          template={template}
          sidebar={sidebar}
          onPick={(home) =>
            edit(`Moved to ${home.project?.title ?? home.area?.title ?? "no Area"}`, { parent: home.parent }, (row) => {
              const { area: _area, project: _project, ...rest } = row;
              return { ...rest, ...home };
            })
          }
        />
        {template.labels.map((label) => (
          <span key={label._id} className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 text-small text-foreground/80">
            <AreaDot colour={label.colour} className="size-1.5" />
            <span className="truncate">{label.name}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          <LabelPicker
            labels={labels.map((label) => ({ id: label._id, name: label.name, colour: label.colour }))}
            selected={template.labelIds}
            onToggle={({ id }) => {
              const label = labels.find((entry) => entry._id === id);
              if (!label) return;
              const has = template.labelIds.includes(label._id);
              setLabels(has ? template.labels.filter((entry) => entry._id !== label._id) : [...template.labels, label]);
            }}
            onCreate={createLabel}
            onColour={({ id }, colour) => recolourLabel(id, colour)}
          />
          <DeadlineOffset
            days={template.deadlineOffsetDays}
            onChange={(days) =>
              edit(days === null ? "Deadline cleared" : offsetLabel(days), { deadlineOffsetDays: days }, withField("deadlineOffsetDays", days))
            }
          />
          <ToolButton icon={Trash} label="Delete Template" className="hover:text-negative" onClick={() => actions.remove(template)} />
        </span>
      </div>
    </div>
  );
};

const Meta = ({ template }: { template: TemplateRow }) => {
  const context = template.project?.title ?? template.area?.title;
  if (!context && template.checklistCount === 0 && template.deadlineOffsetDays === undefined) return null;
  return (
    <span className="flex items-center gap-3 text-small text-muted-foreground">
      {context && (
        <span className="flex min-w-0 items-center gap-1.5">
          {template.area && <AreaDot colour={template.area.colour} />}
          <span className="truncate">{context}</span>
        </span>
      )}
      {template.checklistCount > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-micro text-faint-foreground">
          <ListChecks className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Checklist Items: </span>
          {template.checklistCount}
        </span>
      )}
      {template.deadlineOffsetDays !== undefined && (
        <span className="inline-flex shrink-0 items-center gap-1 text-deadline">
          <Flag weight="fill" className="size-3" aria-hidden="true" />
          {offsetLabel(template.deadlineOffsetDays)}
        </span>
      )}
    </span>
  );
};

const TemplateItem = ({
  template,
  open,
  onOpen,
  labels,
  sidebar,
  onMoveUp,
  onMoveDown,
}: {
  template: TemplateRow;
  open: boolean;
  onOpen: (open: boolean) => void;
  labels: readonly Label[];
  sidebar: SidebarView | undefined;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) => {
  const reduce = useReducedMotion();
  const container = useRef<HTMLLIElement>(null);
  const actions = useTemplateActions();
  const pending = isOptimistic(template._id);
  const sortable = onMoveUp !== undefined || onMoveDown !== undefined;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: template._id,
    disabled: { draggable: !sortable, droppable: pending },
    ...(reduce ? { transition: null } : {}),
  });
  const setRowRef = useCallback((node: HTMLLIElement | null) => {
    container.current = node;
    setNodeRef(node);
  }, [setNodeRef]);
  const closeFromOutside = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Node && container.current?.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest(OUTSIDE)) return;
    onOpen(false);
  });
  useEffect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  return (
    <motion.li
      ref={setRowRef}
      data-template-id={template._id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 select-none")}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      transition={reduce ? instant : springLayout}
    >
      <motion.div
        initial={false}
        animate={{ marginTop: open ? 8 : 0, marginBottom: open ? 8 : 0 }}
        transition={reduce ? instant : springLayout}
        onKeyDown={(event) => {
          if (!open || event.key !== "Escape" || !container.current?.contains(event.target as Node)) return;
          event.preventDefault();
          onOpen(false);
          requestAnimationFrame(() => container.current?.querySelector<HTMLElement>("[data-arrow-item]")?.focus({ preventScroll: true }));
        }}
        className={cn(
          "@container rounded-xl transition-[background-color,box-shadow] duration-(--dur-fast) ease-out",
          open || isDragging ? "bg-popover shadow-lift" : "hover:bg-foreground/[0.04] has-[[data-arrow-item]:focus-visible]:bg-foreground/[0.07]",
        )}
      >
        <div className="flex items-start gap-3 px-3 py-2">
          {sortable ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Drag ${template.title}`}
              className="-my-1 -mx-1.5 grid size-[30px] shrink-0 cursor-grab touch-none place-items-center rounded-md text-faint-foreground hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing"
            >
              <DotsSixVertical weight="bold" className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <span className="mt-[3px] grid size-[18px] shrink-0 place-items-center">
              <Stamp weight="fill" className="size-4 text-faint-foreground" aria-hidden="true" />
            </span>
          )}
          {open ? (
            <TitleInput title={template.title} onCommit={(title) => actions.edit(template, "Template renamed", { title }, (row) => ({ ...row, title }))} />
          ) : (
            <button
              type="button"
              data-arrow-item
              aria-expanded={false}
              disabled={pending}
              onClick={() => onOpen(true)}
              className="min-w-0 flex-1 rounded-md text-left outline-none"
            >
              <span className="block truncate">{template.title}</span>
              <Meta template={template} />
            </button>
          )}
          {!open && template.estimateMinutes !== undefined && <EstimateChip minutes={template.estimateMinutes} className="mt-px" />}
          {sortable && (
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label={`Actions for ${template.title}`}
                  className="-my-1 -mr-1.5 grid size-[30px] shrink-0 place-items-center rounded-md text-faint-foreground hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <DotsThree weight="bold" className="size-5" aria-hidden="true" />
                </button>
              }
              groups={[
                { items: [
                  { id: "up", label: "Move Up", icon: ArrowUp, disabled: !onMoveUp, onSelect: onMoveUp },
                  { id: "down", label: "Move Down", icon: ArrowDown, disabled: !onMoveDown, onSelect: onMoveDown },
                ] },
              ]}
            />
          )}
        </div>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={reduce ? instant : springLayout}
              className="overflow-hidden"
            >
              <TemplateEditor template={template} labels={labels} sidebar={sidebar} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.li>
  );
};

export const TemplatesList = () => {
  const { today } = useShell();
  const templates = useView(api.planner.templates.list, {});
  const labels = useQuietView(api.planner.labels.list, {}) ?? [];
  const sidebar = useQuietView(api.planner.sidebar.get, { date: today });
  const on = useFeatures().of("templates")?.enabled ?? true;
  const [openId, setOpenId] = useState<string | null>(null);
  const actions = useTemplateActions();
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!templates) return <ListSkeleton />;
  if (!on)
    return (
      <EmptyState
        title="Templates are off"
        hint={
          templates.length === 0
            ? "Switch them on to save a Task's shape and start new Tasks from it."
            : `Your ${templates.length === 1 ? "Template is" : `${templates.length} Templates are`} kept, and come back when you switch Templates on.`
        }
        className="py-16"
      />
    );
  if (templates.length === 0)
    return (
      <EmptyState
        title="No Templates yet"
        hint="Right-click a Task and choose Save as Template. Its notes, Checklist, Estimate, Labels and home come along."
        className="py-16"
      />
    );
  const sortable = templates.filter((template) => !isOptimistic(template._id));
  const move = (id: string | number, to: number) => {
    const from = sortable.findIndex((template) => template._id === id);
    const template = sortable[from];
    const target = sortable[to];
    if (!template || !target || from === to) return;
    const ordered = arrayMove(sortable, from, to);
    const before = ordered[to - 1]?.order ?? null;
    const after = ordered[to + 1]?.order ?? null;
    const placement = from < to ? "after" : "before";
    const order = before !== null && before === after ? null : generateKeyBetween(before, after);
    actions.reorder(template, target._id, placement, order ?? template.order);
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={({ active, over }) => move(active.id, sortable.findIndex((template) => template._id === over?.id))}
    >
      <SortableContext items={sortable.map((template) => template._id)} strategy={verticalListSortingStrategy}>
        <ul aria-label="Templates" className="-mx-3">
          <AnimatePresence initial={false}>
            {templates.map((template) => {
              const index = sortable.indexOf(template);
              return (
                <TemplateItem
                  key={template._id}
                  template={template}
                  open={openId === template._id}
                  onOpen={(open) => setOpenId(open ? template._id : null)}
                  labels={labels}
                  sidebar={sidebar?.ok ? sidebar.value : undefined}
                  onMoveUp={index > 0 ? () => move(template._id, index - 1) : undefined}
                  onMoveDown={index >= 0 && index < sortable.length - 1 ? () => move(template._id, index + 1) : undefined}
                />
              );
            })}
          </AnimatePresence>
        </ul>
      </SortableContext>
    </DndContext>
  );
};

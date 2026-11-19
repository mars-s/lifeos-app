"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { ViewTransition, startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type { IsoDate } from "@lifeos/backend/date";
import { blockMinutesFor } from "@lifeos/backend/plan";
import type { PlannerTask } from "@lifeos/backend/types";
import { Segmented } from "@/components/ui/segmented-control";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { longDay, minuteOfDay, startOfWeek } from "../dates";
import { drafts } from "../drafts";
import { ListSkeleton } from "../list-page";
import { usePlanActions, type PlanActions } from "../planner/actions";
import { planCommands } from "../planner/commands";
import { PlannerDrag, usePlanCommit, usePlanRegistry } from "../planner/drag";
import { BrainDump, DayColumn } from "../planner/lists";
import { INBOX, dayContainer, nextFreeSlot, usePlanner, type PlannerModel } from "../planner/model";
import { useSleep } from "../planner/sleep";
import { previewSpread, sleepOn, type SpreadPreview } from "../planner/spread";
import { newDraft, smartBusy, useSmartActions, useSmartBlocks, useSmartFill, type SmartDraft } from "../planner/smart-blocks";
import type { SmartFill } from "@lifeos/backend/smartBlocks";
import { TimeboxPane, type TimeboxView } from "../planner/timebox-pane";
import { selection } from "../selection";
import type { PlannerTab } from "../route";
import { useShell } from "../shell-context";
import { ScreenTabs, type ScreenTab } from "../screen-tabs";
import { LIST_META, PLANNER_META } from "../sidebar";
import { UpcomingList } from "./upcoming";

type Pane = "dump" | "days" | "timebox";

const PANES = [
  { value: "dump", label: "Brain Dump" },
  { value: "days", label: "Days" },
  { value: "timebox", label: "Timebox" },
] satisfies { value: Pane; label: string }[];

const PANEL_ID = "planner-panel";

const SCREEN_TABS = [
  { to: { kind: "planner" }, label: PLANNER_META.label, icon: PLANNER_META.icon },
  { to: { kind: "upcoming" }, label: LIST_META.upcoming.label, icon: LIST_META.upcoming.icon },
] satisfies ScreenTab[];

const TABBED_BELOW_PX = 896;

const useTabbed = () => {
  const root = useRef<HTMLDivElement>(null);
  const [tabbed, setTabbed] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setTabbed((entry?.contentRect.width ?? TABBED_BELOW_PX) < TABBED_BELOW_PX));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { root, tabbed };
};

const BLOCKED_BY = "[data-open-card], [role=menu], [role=dialog]";

const SMART_DEFAULT_MINUTES = 120;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const rowButton = (key: string, list?: string) =>
  [...document.querySelectorAll<HTMLElement>(`#main ${list ? `[data-plan-list="${list}"] ` : ""}[data-task-key="${CSS.escape(key)}"] [data-arrow-item]`)].at(-1);

const FOCUS_TRIES = 12;

const focusRow = (key: string, list: string, tries = FOCUS_TRIES) =>
  requestAnimationFrame(() => {
    const button = rowButton(key, list);
    if (!button && tries > 0) return void focusRow(key, list, tries - 1);
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

const shows = (pane: Pane, shown: Pane, wide: boolean) =>
  pane === shown ? (wide ? "flex" : "flex @4xl/planner:hidden") : wide ? "hidden @4xl/planner:flex" : "hidden";

const Panes = ({
  model,
  today,
  actions,
  view,
  setView,
  pane,
  setPane,
  tabbed,
}: {
  tabbed: boolean;
  model: PlannerModel;
  today: IsoDate;
  actions: PlanActions;
  view: TimeboxView;
  setView: (view: TimeboxView) => void;
  pane: Pane;
  setPane: (pane: Pane) => void;
}) => {
  const { setOpenCard } = useShell();
  const registry = usePlanRegistry();
  const commit = usePlanCommit(today, actions);
  const week = view.mode === "week";
  const dates = model.days.map((day) => day.date);
  const nights = useSleep(dates, today);
  const smartRange = useSmartBlocks(dates);
  const smartActions = useSmartActions();
  const smartDraftAt = (date: IsoDate) => {
    const opens = model.workingHours.startMinute;
    const earliest = date === today ? Math.max(minuteOfDay(Date.now()), opens) : opens;
    const busy = [...(model.days.find((day) => day.date === date)?.busy ?? []), ...smartBusy(smartRange, date)].toSorted((a, b) => a.start - b.start);
    const start = nextFreeSlot(busy, SMART_DEFAULT_MINUTES, earliest);
    return newDraft(date, start, Math.min(24 * 60, start + SMART_DEFAULT_MINUTES));
  };
  const [smartDraft, setSmartDraft] = useState<SmartDraft | null>(() =>
    planCommands.pendingSmartBlock ? smartDraftAt(planCommands.pendingSmartBlock) : null,
  );
  const [smartPending, setSmartPending] = useState<{ date: IsoDate; fill: SmartFill } | null>(null);
  const smartFill = useSmartFill(smartDraft, view.anchor);
  const previewOn = (date: IsoDate) => {
    const index = model.days.findIndex((day) => day.date === date);
    const day = model.days[index];
    return day ? previewSpread({ day, model, sleep: [...sleepOn(nights, index), ...smartBusy(smartRange, date)], today, now: Date.now() }) : null;
  };
  const [spread, setSpread] = useState<SpreadPreview | null>(() => (planCommands.pending ? previewOn(planCommands.pending) : null));

  const showDate = (date: IsoDate) => {
    setView(view.mode === "day" || startOfWeek(date) !== startOfWeek(view.anchor) ? { mode: view.mode, anchor: date } : view);
    if (tabbed) setPane("timebox");
  };

  const editSmartBlock = (next: SmartDraft | null) => {
    if (next && !smartDraft) setSpread(null);
    setSmartDraft(next);
  };

  const startSmartBlock = useEffectEvent((date: IsoDate) => {
    editSmartBlock(smartDraftAt(date));
    showDate(date);
  });

  const acceptSmartBlock = useEffectEvent(() => {
    if (!smartDraft || !smartFill || smartDraft.title.trim() === "") return;
    haptic("drop");
    const pending = { date: smartDraft.date, fill: smartFill };
    setSmartPending(pending);
    void smartActions.accept(smartDraft, smartFill, () => setSmartPending((current) => (current === pending ? null : current)));
    setSmartDraft(null);
  });

  const startSpread = useEffectEvent((date: IsoDate) => {
    const preview = previewOn(date);
    if (!preview) return;
    setSmartDraft(null);
    setSpread(preview);
    setView(view.mode === "day" || startOfWeek(date) !== startOfWeek(view.anchor) ? { mode: view.mode, anchor: date } : view);
    if (tabbed) setPane("timebox");
  });

  const applySpread = useEffectEvent(() => {
    if (!spread || spread.picks.length === 0) return;
    haptic("drop");
    actions.spread(spread.date, spread.picks, spread.unfit.length);
    setSpread(null);
  });

  const addBlock = useEffectEvent((task: PlannerTask) => {
    const date = task.when.kind === "scheduled" && task.when.date > today ? (task.when.date as IsoDate) : today;
    const minutes = blockMinutesFor(task.estimateMinutes);
    const opens = model.workingHours.startMinute;
    const earliest = date === today ? Math.max(minuteOfDay(Date.now()), opens) : opens;
    const busy = model.days.find((day) => day.date === date)?.busy ?? [];
    actions.createBlock(task, date, nextFreeSlot(busy, minutes, earliest));
    setView(view.mode === "day" || startOfWeek(date) !== startOfWeek(view.anchor) ? { mode: view.mode, anchor: date } : view);
  });

  useEffect(() => {
    planCommands.addBlock = addBlock;
    planCommands.spread = startSpread;
    planCommands.smartBlock = startSmartBlock;
    planCommands.pending = null;
    planCommands.pendingSmartBlock = null;
    return () => {
      planCommands.addBlock = null;
      planCommands.spread = null;
      planCommands.smartBlock = null;
    };
  }, []);

  const onPreviewKey = useEffectEvent((event: KeyboardEvent) => {
    if ((!smartDraft && !spread) || event.defaultPrevented || isTyping(event.target) || document.querySelector(BLOCKED_BY)) return;
    if (event.key !== "Escape" && !(event.key === "Enter" && !(event.target instanceof HTMLButtonElement))) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setSmartDraft(null);
      setSpread(null);
    } else if (smartDraft) acceptSmartBlock();
    else applySpread();
  });

  useEffect(() => {
    const listen = (event: KeyboardEvent) => onPreviewKey(event);
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, []);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTyping(event.target) || event.altKey || event.shiftKey) return;
    if (document.querySelector(BLOCKED_BY)) return;
    const command = event.metaKey || event.ctrlKey;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onRow = focused?.closest<HTMLElement>("[data-task-key]")?.dataset.taskKey;
    if (!command && event.key.toLowerCase() === "b") {
      const [only, ...others] = selection.tasks();
      const held = onRow ? [...registry.values()].flat().find((row) => row.key === onRow)?.task : undefined;
      const task = only && others.length === 0 ? only : others.length === 0 ? held : undefined;
      if (!task || task.status.kind !== "open") return;
      event.preventDefault();
      addBlock(task);
      return;
    }
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const sideways = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const [chosen, ...rest] = selection.keys();
    const key = onRow ?? (command && rest.length === 0 ? chosen : undefined);
    const list = key && (onRow ? focused : rowButton(key))?.closest<HTMLElement>("[data-plan-list]")?.dataset.planList;
    if (!key || !list || (vertical === 0 && sideways === 0) || (vertical !== 0 && !command)) return;
    const order = [INBOX, ...model.days.map((day) => dayContainer(day.date))];
    const rows = registry.get(list) ?? [];
    const at = rows.findIndex((row) => row.key === key);
    const row = rows[at];
    if (!row) return;
    event.preventDefault();
    if (vertical !== 0) {
      const to = at + vertical;
      if (to >= 0 && to < rows.length && commit(row.task, list, list, arrayMove([...rows], at, to))) focusRow(key, list);
      return;
    }
    if (command) {
      const target = order[order.indexOf(list) + sideways];
      if (!target) return;
      const others = (registry.get(target) ?? []).filter((other) => other.key !== key);
      if (commit(row.task, list, target, [...others, row])) focusRow(key, target);
      return;
    }
    for (let next = order.indexOf(list) + sideways; next >= 0 && next < order.length; next += sideways) {
      const items = [...document.querySelectorAll<HTMLElement>(`[data-plan-list="${order[next]}"] [data-arrow-item]`)];
      const item = items[Math.min(at, items.length - 1)];
      if (!item || item.offsetParent === null) continue;
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
  });

  useEffect(() => {
    const listen = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);

  const openTask = (task: PlannerTask, date: IsoDate) => {
    const key = drafts.keyFor(task._id);
    const open = () => {
      const row = document.querySelector<HTMLElement>(`#main [data-task-key="${CSS.escape(key)}"]`);
      if (!row || row.offsetParent === null) return false;
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
      selection.clear();
      setOpenCard({ key, instant: false });
      return true;
    };
    if (open() || task.status.kind !== "open") return;
    setPane(task.when.kind === "inbox" ? "dump" : "days");
    if (week && task.when.kind !== "inbox") setView({ mode: "day", anchor: date });
    requestAnimationFrame(() => requestAnimationFrame(open));
  };

  return (
    <div className="flex min-h-0 flex-1 gap-1 px-1 @4xl/planner:px-2">
      <BrainDump tasks={model.dump} actions={actions} className={cn("w-full @4xl/planner:w-[17rem] @4xl/planner:shrink-0", shows("dump", pane, true))} />
      <ViewTransition>
      <div
        role="group"
        aria-label="Days"
        data-plan-scroll="lists"
        data-plan-strip=""
        className={cn(
          "min-w-0 flex-1 snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] @4xl/planner:snap-none",
          shows("days", pane, !week),
        )}
      >
        {model.days.map((day) => (
          <DayColumn key={day.date} day={day} today={today} actions={actions} onSpread={startSpread} />
        ))}
      </div>
      </ViewTransition>
      <ViewTransition>
      <TimeboxPane
        narrow={tabbed}
        today={today}
        view={view}
        onView={setView}
        workingHours={model.workingHours}
        actions={actions}
        onOpenTask={openTask}
        spread={spread}
        onApplySpread={applySpread}
        onCancelSpread={() => setSpread(null)}
        smart={{ draft: smartDraft, fill: smartFill, pending: smartPending, setDraft: editSmartBlock, onAccept: acceptSmartBlock }}
        className={cn("w-full", week ? "@4xl/planner:min-w-0 @4xl/planner:flex-1" : "@4xl/planner:w-[21rem] @4xl/planner:shrink-0", shows("timebox", pane, true))}
      />
      </ViewTransition>
    </div>
  );
};

export const PlannerScreen = ({ tab }: { tab: PlannerTab }) => {
  const { today, via } = useShell();
  const model = usePlanner(today);
  const actions = usePlanActions(today);
  const [view, setView] = useState<TimeboxView>({ mode: "day", anchor: today });
  const [pane, setPane] = useState<Pane>("days");
  const { root, tabbed } = useTabbed();
  const byPointer = useRef(false);
  const board = tab === "planner";
  const name = board ? PLANNER_META.label : LIST_META.upcoming.label;

  const showBlock = (date: IsoDate) =>
    setView((current) => (current.mode === "day" || startOfWeek(date) !== startOfWeek(current.anchor) ? { mode: current.mode, anchor: date } : current));

  const changeView = (next: TimeboxView) => {
    if (byPointer.current && next.mode !== view.mode && !tabbed) startTransition(() => setView(next));
    else setView(next);
  };

  return (
    <div
      ref={root}
      onPointerDownCapture={() => {
        byPointer.current = true;
      }}
      onKeyDownCapture={() => {
        byPointer.current = false;
      }}
      className={cn("@container/planner flex flex-col", board && "h-[calc(100dvh-3rem)] overflow-hidden md:h-[calc(100dvh-0.75rem)]")}
    >
      <title>{`${name} · LifeOS`}</title>
      <header
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-1 pb-3 md:px-6 md:pt-5 md:pb-4",
          !board && "sticky top-12 z-10 bg-surface-inset/85 backdrop-blur-md md:top-0",
        )}
      >
        <h1 className="sr-only">{name}</h1>
        <ScreenTabs label="Planner view" tabs={SCREEN_TABS} panel={PANEL_ID} />
        <p className="text-small text-muted-foreground max-sm:hidden">{longDay(today)}</p>
        {board && (
          <Segmented
            label="Planner pane"
            options={PANES}
            value={pane}
            onValueChange={(next) => {
              haptic("toggle");
              setPane(next);
            }}
            className="ml-auto @4xl/planner:hidden"
          />
        )}
      </header>
      <div
        key={tab}
        id={PANEL_ID}
        role="tabpanel"
        aria-label={name}
        className={cn(board && "flex min-h-0 flex-1 flex-col", via === "pointer" && "animate-fade-in")}
      >
        {!board ? (
          <UpcomingList />
        ) : model ? (
          <PlannerDrag today={today} actions={actions} onBlock={showBlock}>
            <Panes model={model} today={today} actions={actions} view={view} setView={changeView} pane={pane} setPane={setPane} tabbed={tabbed} />
          </PlannerDrag>
        ) : (
          <div className="px-6">
            <ListSkeleton />
          </div>
        )}
      </div>
    </div>
  );
};

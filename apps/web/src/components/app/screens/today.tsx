"use client";

import { Moon } from "@phosphor-icons/react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import { CommitmentStrip } from "@/components/lifeos/commitments";
import { formatMinutes } from "@/components/lifeos/format";
import { EmptyState } from "@/components/lifeos/states";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useCommitmentsByDay, useFreeToday } from "../calendar";
import { cn } from "@/lib/utils";
import { longDay } from "../dates";
import { useLiveFocus } from "../focus";
import { useView, valueOf } from "../hooks";
import { ListPage, ListSkeleton, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { placeAttr } from "../new-task-place";
import { LIST_META } from "../sidebar";
import { TaskItems, useHasDrafts } from "../task-item";

const NO_COMMITMENTS = [] as const;
const DOT_MINUTES = 15;
const MAX_DOTS = 48;

const dotsFor = (minutes: number) => (minutes <= 0 ? 0 : Math.max(1, Math.round(minutes / DOT_MINUTES)));

const PlannedStrip = ({ tasks }: { tasks: PlannerTask[] }) => {
  const live = useLiveFocus();
  const rows = tasks.map((task) => ({
    colour: task.area ? areaVar(task.area.colour) : "var(--muted-foreground)",
    estimate: task.estimateMinutes ?? 0,
    done: Math.floor((task.focus.ms + (live.taskId === task._id ? live.ms : 0)) / 60_000),
  }));
  const total = rows.reduce((sum, row) => sum + row.estimate, 0);
  const done = rows.reduce((sum, row) => sum + row.done, 0);
  if (total === 0 && done === 0) return null;
  const unplanned = rows.filter((row) => row.estimate === 0).length;
  const dots = rows
    .flatMap((row) => {
      const filled = dotsFor(row.done);
      return Array.from({ length: Math.max(dotsFor(row.estimate), filled) }, (_, index) => ({ colour: row.colour, done: index < filled }));
    })
    .slice(0, MAX_DOTS);
  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2"
      title="One dot is 15 minutes, in its Area colour. A solid dot is time already spent in focus."
    >
      <span aria-hidden="true" className="flex flex-wrap gap-[5px]">
        {dots.map((dot, index) => (
          <span
            key={index}
            className="size-2 animate-dot-in rounded-full transition-[background-color] duration-(--dur-slow) ease-out"
            style={{ backgroundColor: dot.done ? dot.colour : `color-mix(in oklab, ${dot.colour} 36%, transparent)` }}
          />
        ))}
      </span>
      <p className="text-small text-muted-foreground">
        {done > 0 && (
          <>
            <RollingNumber value={formatMinutes(done)} className="font-mono text-foreground" /> done of{" "}
          </>
        )}
        <RollingNumber value={formatMinutes(total)} className={cn("font-mono", done === 0 && "text-foreground")} /> estimated
        {unplanned > 0 && <span className="text-faint-foreground">, {unplanned} without an Estimate</span>}
      </p>
    </div>
  );
};

const CalendarToday = ({ today }: { today: IsoDate }) => {
  const items = useCommitmentsByDay(today, today).get(today) ?? NO_COMMITMENTS;
  const free = useFreeToday(today);
  if (items.length === 0 && free === null) return null;
  return <CommitmentStrip items={items} free={free} />;
};

const EVENING_SLOT = "/today:evening";

export const TodayScreen = () => {
  const { today } = useShell();
  const view = valueOf(useView(api.planner.today.get, { date: today }));
  const drafting = useHasDrafts();
  return (
    <ListPage title="Today" icon={LIST_META.today.icon} subtitle={longDay(today)}>
      <CalendarToday today={today} />
      {!view ? (
        <ListSkeleton />
      ) : view.tasks.length + view.evening.length === 0 && !drafting ? (
        <EmptyState spot="today-clear" title="Today is clear" hint="Nothing scheduled and nothing due. Enjoy the space." className="py-16" />
      ) : (
        <>
          <PlannedStrip tasks={[...view.tasks, ...view.evening]} />
          <TaskItems tasks={view.tasks} show={{ context: true }} hostsDrafts="inline" />
          {view.evening.length > 0 && (
            <section {...placeAttr({ slot: EVENING_SLOT, when: { kind: "scheduled", date: today, evening: true } })}>
              <SectionHeading leading={<Moon weight="fill" className="size-4 text-muted-foreground" aria-hidden="true" />}>
                This Evening
              </SectionHeading>
              <TaskItems tasks={view.evening} show={{ context: true }} hostsDrafts="inline" slot={EVENING_SLOT} />
            </section>
          )}
        </>
      )}
    </ListPage>
  );
};

export const InboxScreen = () => {
  const view = useView(api.planner.lists.inbox, {});
  const drafting = useHasDrafts();
  return (
    <ListPage title="Inbox" icon={LIST_META.inbox.icon}>
      {!view ? (
        <ListSkeleton />
      ) : view.tasks.length === 0 && !drafting ? (
        <EmptyState spot="inbox-empty" title="The Inbox is empty" hint="New thoughts land here, ready to sort." className="py-16" />
      ) : (
        <TaskItems tasks={view.tasks} hostsDrafts="inline" sortable />
      )}
    </ListPage>
  );
};

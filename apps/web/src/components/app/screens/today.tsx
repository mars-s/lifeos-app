"use client";

import { Moon } from "@phosphor-icons/react";
import { api } from "@lifeos/backend/api";
import type { PlannerTask } from "@lifeos/backend/types";
import { areaVar } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { EmptyState } from "@/components/lifeos/states";
import { RollingNumber } from "@/components/ui/rolling-number";
import { longDay } from "../dates";
import { useView, valueOf } from "../hooks";
import { ListPage, ListSkeleton, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { LIST_META } from "../sidebar";
import { TaskItems } from "../task-item";

const DOT_MINUTES = 15;
const MAX_DOTS = 48;

const PlannedStrip = ({ tasks }: { tasks: PlannerTask[] }) => {
  const planned = tasks.filter((task) => task.estimateMinutes !== undefined);
  const total = planned.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0);
  if (total === 0) return null;
  const dots = planned
    .flatMap((task) =>
      Array.from({ length: Math.max(1, Math.round((task.estimateMinutes ?? 0) / DOT_MINUTES)) }, () =>
        task.area ? areaVar(task.area.colour) : "var(--muted-foreground)",
      ),
    )
    .slice(0, MAX_DOTS);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2" title="One dot is 15 minutes of Estimate, in its Area colour">
      <span aria-hidden="true" className="flex flex-wrap gap-[5px]">
        {dots.map((colour, index) => (
          <span
            key={index}
            className="size-2 animate-dot-in rounded-full transition-[background-color] duration-(--dur-base) ease-out"
            style={{ backgroundColor: colour }}
          />
        ))}
      </span>
      <p className="text-small text-muted-foreground">
        <RollingNumber value={formatMinutes(total)} className="font-mono text-foreground" /> estimated
        {planned.length < tasks.length && (
          <span className="text-faint-foreground">
            , {tasks.length - planned.length} without an Estimate
          </span>
        )}
      </p>
    </div>
  );
};

export const TodayScreen = () => {
  const { today } = useShell();
  const view = valueOf(useView(api.planner.today.get, { date: today }));
  return (
    <ListPage title="Today" icon={LIST_META.today.icon} subtitle={longDay(today)}>
      {!view ? (
        <ListSkeleton />
      ) : view.tasks.length + view.evening.length === 0 ? (
        <EmptyState spot="today-clear" title="Today is clear" hint="Nothing scheduled and nothing due. Enjoy the space." className="py-16" />
      ) : (
        <>
          <PlannedStrip tasks={[...view.tasks, ...view.evening]} />
          <TaskItems tasks={view.tasks} show={{ context: true }} />
          {view.evening.length > 0 && (
            <>
              <SectionHeading leading={<Moon weight="fill" className="size-4 text-muted-foreground" aria-hidden="true" />}>
                This Evening
              </SectionHeading>
              <TaskItems tasks={view.evening} show={{ context: true }} />
            </>
          )}
        </>
      )}
    </ListPage>
  );
};

export const InboxScreen = () => {
  const view = useView(api.planner.lists.inbox, {});
  return (
    <ListPage title="Inbox" icon={LIST_META.inbox.icon}>
      {!view ? (
        <ListSkeleton />
      ) : view.tasks.length === 0 ? (
        <EmptyState spot="inbox-empty" title="The Inbox is empty" hint="New thoughts land here, ready to sort." className="py-16" />
      ) : (
        <TaskItems tasks={view.tasks} />
      )}
    </ListPage>
  );
};

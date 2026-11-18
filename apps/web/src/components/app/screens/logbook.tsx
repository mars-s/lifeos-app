"use client";

import { usePaginatedQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { ActivityTimeline, type Brush } from "@/components/lifeos/activity-timeline";
import { EmptyState } from "@/components/lifeos/states";
import { endOfLocalDay, localDate, longDay, relativeDay, startOfLocalDay } from "../dates";
import { useView } from "../hooks";
import { ListPage, ListSkeleton, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { LIST_META } from "../sidebar";
import { TaskItem } from "../task-item";

const TIMELINE_DAYS = 56;
const PAGE_SIZE = 40;

const shortLabel = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

const groupByDay = (tasks: PlannerTask[]) => {
  const days = new Map<IsoDate, PlannerTask[]>();
  for (const task of tasks) {
    if (task.status.kind === "open") continue;
    const date = localDate(task.status.at);
    days.set(date, [...(days.get(date) ?? []), task]);
  }
  return [...days];
};

export const LogbookScreen = () => {
  const { today } = useShell();
  const [brush, setBrush] = useState<Brush | null>(null);
  const dates = useMemo(() => Array.from({ length: TIMELINE_DAYS }, (_, index) => addDays(today, index - TIMELINE_DAYS + 1)), [today]);
  const first = dates[0] ?? today;
  const timeline = useView(api.planner.lists.logbookTimeline, { from: startOfLocalDay(first) });
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const at of timeline?.closedAt ?? []) counts.set(localDate(at), (counts.get(localDate(at)) ?? 0) + 1);
    return dates.map((date) => ({ label: shortLabel.format(Date.parse(`${date}T00:00:00Z`)), count: counts.get(date) ?? 0 }));
  }, [dates, timeline]);
  const range = brush
    ? { from: startOfLocalDay(dates[brush.from] ?? first), to: endOfLocalDay(dates[brush.to] ?? today) }
    : {};
  const { results, status, loadMore } = usePaginatedQuery(api.planner.lists.logbook, range, { initialNumItems: PAGE_SIZE });
  const loading = status === "LoadingFirstPage";

  return (
    <ListPage title="Logbook" icon={LIST_META.logbook.icon}>
      {timeline && timeline.closedAt.length === 0 && !loading && results.length === 0 && !brush ? (
        <EmptyState spot="logbook" title="Nothing logged yet" hint="Completed Tasks collect here, a day at a time." className="py-16" />
      ) : (
        <>
          <div className="mb-2 rounded-2xl bg-foreground/[0.03] p-4">
            <ActivityTimeline days={days} brush={brush} onBrushChange={setBrush} />
          </div>
          {loading ? (
            <ListSkeleton />
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-small text-muted-foreground">No Tasks were completed in this range.</p>
          ) : (
            groupByDay(results).map(([date, tasks]) => (
              <section key={date}>
                <SectionHeading aside={<span className="font-mono text-small font-normal text-faint-foreground">{tasks.length}</span>}>
                  {relativeDay(date, today) ?? longDay(date)}
                </SectionHeading>
                <ul className="-mx-3">
                  {tasks.map((task) => (
                    <TaskItem key={task._id} task={task} show={{ context: true, closedAt: true }} />
                  ))}
                </ul>
              </section>
            ))
          )}
          {(status === "CanLoadMore" || status === "LoadingMore") && (
            <button
              type="button"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(PAGE_SIZE)}
              className="mt-6 h-8 rounded-full bg-foreground/[0.06] px-3.5 text-small font-medium transition-[background-color,scale,opacity] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97] disabled:opacity-60"
            >
              {status === "LoadingMore" ? "Loading…" : "Show earlier Tasks"}
            </button>
          )}
        </>
      )}
    </ListPage>
  );
};

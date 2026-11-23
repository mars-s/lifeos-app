"use client";

import { ArrowUUpLeft } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { TrashRow } from "@lifeos/backend/types";
import { AreaDot } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { EmptyState } from "@/components/lifeos/states";
import { instant, springLayout } from "@/lib/motion-tokens";
import { clockTime, localDate, longDay, relativeDay } from "../dates";
import { useView } from "../hooks";
import { Arrive, Fold, Folding } from "../fold";
import { ListPage, ListSkeleton, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { LIST_META } from "../sidebar";
import { useTrashActions, type TrashActions } from "../trash-actions";

const groupByDay = (rows: readonly TrashRow[]) => {
  const days = new Map<IsoDate, TrashRow[]>();
  for (const row of rows) {
    const date = localDate(row.trashedAt);
    days.set(date, [...(days.get(date) ?? []), row]);
  }
  return [...days];
};

const counted = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

const Glyph = ({ row }: { row: TrashRow }) => (
  <span className="mt-[3px] grid size-[18px] shrink-0 place-items-center text-muted-foreground">
    {row.kind === "area" ? (
      <AreaGlyph colour={row.colour} icon={row.icon} className="opacity-70" />
    ) : row.kind === "project" ? (
      <ProgressPie value={0} colour="var(--muted-foreground)" className="size-[18px] opacity-70" />
    ) : (
      <span className="size-[18px] rounded-[6px] border-[1.5px] border-foreground/15" />
    )}
  </span>
);

const holding = (row: TrashRow) => {
  const parts = [
    ...(row.kind === "area" && row.projects > 0 ? [counted(row.projects, "Project")] : []),
    ...(row.kind !== "task" && row.tasks > 0 ? [counted(row.tasks, "Task")] : []),
  ];
  const name = row.kind === "area" ? "Area" : "Project";
  return parts.length === 0 ? name : `${name} with ${parts.join(" and ")}`;
};

const Meta = ({ row }: { row: TrashRow }) => (
  <>
    {row.kind !== "task" && <span className="shrink-0">{holding(row)}</span>}
    {row.kind !== "area" && row.context && (
      <span className="flex min-w-0 items-center gap-1.5">
        {row.colour && <AreaDot colour={row.colour} />}
        <span className="truncate">{row.context}</span>
      </span>
    )}
  </>
);

const Row = ({ row, actions }: { row: TrashRow; actions: TrashActions }) => {
  const reduce = useReducedMotion();
  return (
    <motion.li
      data-menu-trash={`${row.kind}:${row.id}`}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduce ? instant : springLayout}
      className="overflow-hidden"
    >
      <div className="group/row flex items-start gap-3 rounded-xl px-3 py-2 transition-[background-color] duration-(--dur-fast) ease-out hover:bg-foreground/[0.04] has-[:focus-visible]:bg-foreground/[0.07]">
        <Glyph row={row} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-muted-foreground">{row.title}</p>
          {(row.kind !== "task" || row.context) && (
            <p className="flex min-w-0 items-center gap-x-2 text-small text-faint-foreground">
              <Meta row={row} />
            </p>
          )}
        </div>
        <div className="relative flex h-7 shrink-0 items-center justify-end @sm:min-w-[4.5rem]">
          <time
            dateTime={new Date(row.trashedAt).toISOString()}
            className="hidden font-mono text-small text-faint-foreground transition-opacity duration-(--dur-fast) ease-out group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0 @sm:block pointer-coarse:hidden"
          >
            {clockTime(row.trashedAt)}
          </time>
          <button
            type="button"
            data-arrow-item
            aria-label={`Put back ${row.title}`}
            onClick={() => actions.putBack([row])}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 text-small font-medium whitespace-nowrap transition-[background-color,opacity,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97] pointer-fine:absolute pointer-fine:right-0 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-coarse:size-9 pointer-coarse:justify-center pointer-coarse:px-0"
          >
            <ArrowUUpLeft weight="bold" className="size-3.5" aria-hidden="true" />
            <span className="pointer-coarse:sr-only">Put Back</span>
          </button>
        </div>
      </div>
    </motion.li>
  );
};

export const TrashScreen = () => {
  const { today } = useShell();
  const view = useView(api.planner.trash.list, {});
  const actions = useTrashActions();
  const count = view?.rows.length ?? 0;
  return (
    <ListPage
      title="Trash"
      icon={LIST_META.trash.icon}
      subtitle={view && count > 0 ? "Put anything back, or delete it for good." : undefined}
      aside={
        count > 0 ? (
          <button
            type="button"
            onClick={() => actions.empty(count)}
            className="h-8 shrink-0 rounded-full bg-foreground/[0.06] px-3.5 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97]"
          >
            Empty Trash
          </button>
        ) : undefined
      }
    >
      {!view ? (
        <ListSkeleton />
      ) : (
        <>
          <Fold show={count > 0} appear={false} className="@container">
            <AnimatePresence initial={false}>
              {groupByDay(view.rows).map(([date, rows]) => (
                <Folding key={date}>
                  <section>
                    <SectionHeading aside={<span className="font-mono text-small font-normal text-faint-foreground">{rows.length}</span>}>
                      {relativeDay(date, today) ?? longDay(date)}
                    </SectionHeading>
                    <ul className="-mx-3">
                      <AnimatePresence initial={false}>
                        {rows.map((row) => (
                          <Row key={row.id} row={row} actions={actions} />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </section>
                </Folding>
              ))}
            </AnimatePresence>
            {view.truncated && <p className="mt-6 text-small text-faint-foreground">Showing the newest 500. Put some back or empty Trash to see older ones.</p>}
          </Fold>
          <Arrive show={count === 0}>
            <EmptyState title="Trash is empty" hint="Tasks, Projects and Areas you remove wait here until you put them back or delete them." className="py-16" />
          </Arrive>
        </>
      )}
    </ListPage>
  );
};

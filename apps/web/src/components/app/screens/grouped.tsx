"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import type { SomedayView, TaskGroup } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { EmptyState } from "@/components/lifeos/states";
import { instant, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { useView, valueOf } from "../hooks";
import { Arrive, Fold, Folding } from "../fold";
import { ListPage, ListSkeleton, RouteLink, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { placeAttr, type NewTaskPlace } from "../new-task-place";
import { routeHref } from "../route";
import { LIST_META } from "../sidebar";
import { TaskItems, useHasDrafts, type TaskItemShow } from "../task-item";

const VISIBLE = 3;
const NO_TASKS = [] as const;

const fraction = ({ done, total }: { done: number; total: number }) => (total === 0 ? 0 : done / total);

const GroupHeading = ({ container }: { container: TaskGroup["container"] }) => {
  if (container.kind === "loose") return null;
  const colour = container.kind === "area" ? container.area.colour : container.area?.colour;
  return (
    <SectionHeading
      leading={
        container.kind === "area" ? (
          <AreaDot colour={container.area.colour} className="size-2.5" />
        ) : (
          <ProgressPie value={fraction(container.progress)} colour={colour ? areaVar(colour) : "var(--muted-foreground)"} />
        )
      }
      aside={
        container.kind === "project" && container.area ? (
          <span className="max-w-[40%] shrink-0 truncate text-small font-normal text-faint-foreground">{container.area.title}</span>
        ) : undefined
      }
    >
      <RouteLink
        to={container.kind === "area" ? { kind: "area", id: container.area._id } : { kind: "project", id: container.project._id }}
        className="rounded-sm underline-offset-4 hover:underline"
      >
        {container.kind === "area" ? container.area.title : container.project.title}
      </RouteLink>
    </SectionHeading>
  );
};

const parentOf = (container: TaskGroup["container"]) =>
  (container.kind === "area"
    ? { kind: "area", areaId: container.area._id }
    : container.kind === "project"
      ? { kind: "project", projectId: container.project._id }
      : { kind: "loose" }) satisfies NewTaskPlace["parent"];

const Group = ({ group, show, when }: { group: TaskGroup; show: TaskItemShow; when: "anytime" | "someday" }) => {
  const reduce = useReducedMotion();
  const { openCard, setOpenCard, route } = useShell();
  const slot = `${routeHref(route)}:${group.key}`;
  const [expanded, setExpanded] = useState(false);
  const [settled, setSettled] = useState(false);
  const collapsible = group.container.kind !== "loose" && group.tasks.length > VISIBLE + 1;
  const head = collapsible ? group.tasks.slice(0, VISIBLE) : group.tasks;
  const rest = collapsible ? group.tasks.slice(VISIBLE) : [];
  const showAll = expanded || rest.some((task) => task._id === openCard?.key);
  return (
    <section {...placeAttr({ slot, when: { kind: when }, parent: parentOf(group.container) })}>
      <GroupHeading container={group.container} />
      <TaskItems tasks={head} show={show} hostsDrafts="inline" slot={slot} />
      <AnimatePresence initial={false} onExitComplete={() => setSettled(false)}>
        {showAll && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? instant : springLayout}
            onAnimationStart={() => setSettled(false)}
            onAnimationComplete={() => setSettled(true)}
            className={cn("-mx-3 px-3", !settled && "overflow-hidden")}
          >
            <TaskItems tasks={rest} show={show} />
          </motion.div>
        )}
      </AnimatePresence>
      {rest.length > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => {
            if (showAll) setOpenCard(null);
            setExpanded(!showAll);
          }}
          className="mt-1 -ml-1 h-7 rounded-full px-2.5 text-small font-medium text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.05] hover:text-foreground active:scale-[0.97]"
        >
          {showAll ? "Show fewer" : `Show ${rest.length} more`}
        </button>
      )}
    </section>
  );
};

export const AnytimeScreen = () => {
  const { today } = useShell();
  const view = valueOf(useView(api.planner.lists.anytime, { date: today }));
  const drafting = useHasDrafts();
  return (
    <ListPage title="Anytime" icon={LIST_META.anytime.icon}>
      {!view ? (
        <ListSkeleton />
      ) : (
        <>
          <Fold show={view.groups.length > 0 || drafting} appear={false}>
            <TaskItems tasks={NO_TASKS} show={{ star: true }} hostsDrafts="above" />
            <AnimatePresence initial={false}>
              {view.groups.map((group) => (
                <Folding key={group.key}>
                  <Group group={group} show={{ star: true }} when="anytime" />
                </Folding>
              ))}
            </AnimatePresence>
          </Fold>
          <Arrive show={view.groups.length === 0 && !drafting}>
            <EmptyState spot="anytime" title="Nothing waiting" hint="Tasks you can do whenever you have time show here, grouped by Area." className="py-16" />
          </Arrive>
        </>
      )}
    </ListPage>
  );
};

const ParkedProjects = ({ projects }: { projects: SomedayView["projects"] }) => (
  <section>
    <SectionHeading>Projects</SectionHeading>
    <ul className="-mx-3">
      {projects.map((project) => (
        <li key={project._id}>
          <RouteLink
            to={{ kind: "project", id: project._id }}
            data-arrow-item
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-muted-foreground outline-offset-[-2px] transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.04] active:scale-[0.995]"
          >
            <ProgressPie
              value={fraction(project.progress)}
              colour={project.area ? areaVar(project.area.colour) : "var(--muted-foreground)"}
              className="size-[18px] opacity-70"
            />
            <span className="min-w-0 flex-1 truncate">{project.title}</span>
            {project.area && <span className="shrink-0 text-small text-faint-foreground">{project.area.title}</span>}
            <span title={`${project.progress.done} of ${project.progress.total} Tasks done`} className="shrink-0 font-mono text-small text-faint-foreground">
              {project.progress.done}/{project.progress.total}
              <span className="sr-only"> Tasks done</span>
            </span>
          </RouteLink>
        </li>
      ))}
    </ul>
  </section>
);

export const SomedayScreen = () => {
  const view = useView(api.planner.lists.someday, {});
  const drafting = useHasDrafts();
  return (
    <ListPage title="Someday" icon={LIST_META.someday.icon}>
      {!view ? (
        <ListSkeleton />
      ) : (
        <>
          <Fold show={view.groups.length + view.projects.length > 0 || drafting} appear={false}>
            <TaskItems tasks={NO_TASKS} hostsDrafts="above" />
            <AnimatePresence initial={false}>
              {view.groups.map((group) => (
                <Folding key={group.key}>
                  <Group group={group} show={{}} when="someday" />
                </Folding>
              ))}
            </AnimatePresence>
            <Fold show={view.projects.length > 0}>
              <ParkedProjects projects={view.projects} />
            </Fold>
          </Fold>
          <Arrive show={view.groups.length + view.projects.length === 0 && !drafting}>
            <EmptyState spot="someday" title="No someday ideas yet" hint="Park a Task here when it is worth keeping but not worth planning." className="py-16" />
          </Arrive>
        </>
      )}
    </ListPage>
  );
};

"use client";

import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { AreaView } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { AreaCover } from "@/components/lifeos/art";
import { ProgressPie, ProgressRing } from "@/components/lifeos/progress-ring";
import { EmptyState } from "@/components/lifeos/states";
import { DeadlineMarker } from "@/components/lifeos/task-row";
import { RollingNumber } from "@/components/ui/rolling-number";
import { deadlineMark } from "../dates";
import { useView } from "../hooks";
import { ListPage, ListSkeleton, Missing, RouteLink, SectionHeading } from "../list-page";
import { useShell } from "../shell-context";
import { Linkified, TaskItems } from "../task-item";

const fraction = ({ done, total }: { done: number; total: number }) => (total === 0 ? 0 : done / total);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const ProjectRows = ({ projects, colour }: { projects: AreaView["projects"]; colour: string }) => {
  const { today } = useShell();
  return (
    <ul className="@container space-y-1">
      {projects.map((project) => (
        <li key={project._id}>
          <RouteLink
            to={{ kind: "project", id: project._id }}
            data-arrow-item
            className="flex h-11 items-center gap-3 rounded-xl bg-foreground/[0.04] px-3 outline-offset-[-2px] transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.07] active:scale-[0.99]"
          >
            <ProgressPie value={fraction(project.progress)} colour={colour} className={project.when.kind === "someday" ? "opacity-50" : undefined} />
            <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
            {project.when.kind === "someday" && <span className="shrink-0 text-small text-faint-foreground">Someday</span>}
            {project.deadline && <DeadlineMarker deadline={deadlineMark(project.deadline, today)} className="hidden @md:inline-flex" />}
            <span className="shrink-0 font-mono text-small text-muted-foreground">
              {project.progress.done}/{project.progress.total}
            </span>
          </RouteLink>
        </li>
      ))}
    </ul>
  );
};

export const AreaScreen = ({ areaId }: { areaId: Id<"areas"> }) => {
  const view = useView(api.planner.lists.area, { areaId });
  if (view === null) return <Missing />;
  if (!view)
    return (
      <ListPage>
        <ListSkeleton />
      </ListPage>
    );
  const openInProjects = view.projects.reduce((sum, project) => sum + project.progress.total - project.progress.done, 0);
  return (
    <ListPage
      title={view.area.title}
      leading={<AreaCover colour={view.area.colour} className="size-16 md:size-20" />}
      subtitle={`${plural(view.projects.length, "Project")}, ${plural(view.tasks.length + openInProjects, "Task")}`}
    >
      {view.tasks.length + view.projects.length === 0 ? (
        <EmptyState title="Nothing open here" hint="Tasks and Projects you add to this Area in Things show here." className="py-12" />
      ) : (
        <>
          <TaskItems tasks={view.tasks} show={{ star: true, when: true }} />
          {view.projects.length > 0 && (
            <>
              <SectionHeading className="mb-3 border-b-0">Projects</SectionHeading>
              <ProjectRows projects={view.projects} colour={areaVar(view.area.colour)} />
            </>
          )}
        </>
      )}
    </ListPage>
  );
};

export const ProjectScreen = ({ projectId }: { projectId: Id<"projects"> }) => {
  const { today } = useShell();
  const view = useView(api.planner.lists.project, { projectId });
  if (view === null) return <Missing />;
  if (!view)
    return (
      <ListPage>
        <ListSkeleton />
      </ListPage>
    );
  const colour = view.area ? areaVar(view.area.colour) : "var(--brand)";
  const open = view.sections.reduce((sum, section) => sum + section.tasks.length, 0);
  return (
    <ListPage
      title={view.project.title}
      leading={
        <ProgressRing value={fraction(view.progress)} size={52} stroke={6} colour={colour} label={`${view.project.title} progress`}>
          <span className="sr-only">
            {view.progress.done} of {view.progress.total} done
          </span>
        </ProgressRing>
      }
      subtitle={
        <>
          {view.area && (
            <RouteLink to={{ kind: "area", id: view.area._id }} className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:underline">
              <AreaDot colour={view.area.colour} />
              {view.area.title}
            </RouteLink>
          )}
          {view.project.when.kind === "someday" && <span>Someday</span>}
          {view.project.deadline && <DeadlineMarker deadline={deadlineMark(view.project.deadline, today)} className="[&>span:last-child]:inline" />}
        </>
      }
      aside={
        <p className="flex shrink-0 items-baseline font-mono" aria-hidden="true">
          <RollingNumber value={view.progress.done} className="text-heading font-medium" />
          <span className="text-small text-muted-foreground">/{view.progress.total}</span>
        </p>
      }
    >
      {view.project.notes && (
        <p className="mb-5 text-small break-words whitespace-pre-wrap text-muted-foreground">
          <Linkified text={view.project.notes} />
        </p>
      )}
      {open === 0 && view.sections.length === 1 ? (
        <EmptyState
          spot="done"
          title={view.progress.total === 0 ? "No Tasks yet" : "Every Task is done"}
          hint={view.progress.total === 0 ? "Add Tasks to this Project in Things." : "Complete the Project in Things to send it to the Logbook."}
          className="py-12"
        />
      ) : (
        view.sections.map((section) =>
          section.heading ? (
            <section key={section.heading._id}>
              <SectionHeading>{section.heading.title}</SectionHeading>
              <TaskItems tasks={section.tasks} show={{ star: true, when: true }} />
            </section>
          ) : (
            section.tasks.length > 0 && <TaskItems key="loose" tasks={section.tasks} show={{ star: true, when: true }} />
          ),
        )
      )}
    </ListPage>
  );
};

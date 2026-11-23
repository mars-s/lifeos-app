"use client";

import { DotsThree } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { AreaView } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { DeadlinePicker, WhenPicker } from "@/components/lifeos/date-pickers";
import { AreaCover } from "@/components/lifeos/art";
import { ProgressPie, ProgressRing } from "@/components/lifeos/progress-ring";
import { EmptyState } from "@/components/lifeos/states";
import { DeadlineMarker } from "@/components/lifeos/task-row";
import { RollingNumber } from "@/components/ui/rolling-number";
import { useContainerActions } from "../container-actions";
import { deadlineMark, whenLabel } from "../dates";
import { useView } from "../hooks";
import { ListPage, ListSkeleton, Missing, RouteLink, SectionHeading } from "../list-page";
import { placeAttr } from "../new-task-place";
import { useShell } from "../shell-context";
import { openMenuFor } from "../menus";
import { NotesField } from "../task-card-body";
import { TaskItems, useHasDrafts } from "../task-item";

const fraction = ({ done, total }: { done: number; total: number }) => (total === 0 ? 0 : done / total);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const EditableTitle = ({ title, label, onSave }: { title: string; label: string; onSave: (title: string) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="sr-only">{title}</h1>
      <input
        aria-label={label}
        name="title"
        data-undo={draft === null ? "app" : undefined}
        value={draft ?? title}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft?.trim();
          setDraft(null);
          if (!cancelled.current && next && next !== title) onSave(next);
          cancelled.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "Escape") return;
          event.stopPropagation();
          cancelled.current = event.key === "Escape";
          event.currentTarget.blur();
        }}
        className="field-sizing-content max-w-full min-w-12 rounded-md bg-transparent text-title font-semibold outline-none select-text"
      />
      <button
        type="button"
        aria-label="More actions"
        title="More actions"
        onClick={(event) => openMenuFor(event.currentTarget, event.detail === 0)}
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.92]"
      >
        <DotsThree weight="bold" className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
};

const ProjectRows = ({ projects, colour }: { projects: AreaView["projects"]; colour: string }) => {
  const { today } = useShell();
  return (
    <ul className="@container space-y-1">
      {projects.map((project) => (
        <li key={project._id}>
          <RouteLink
            to={{ kind: "project", id: project._id }}
            data-arrow-item
            data-menu-project={project._id}
            draggable={false}
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
  const drafting = useHasDrafts();
  const actions = useContainerActions(useShell());
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
      menu={{ "data-menu-area": areaId }}
      heading={<EditableTitle title={view.area.title} label="Area title" onSave={(title) => actions.renameArea(view.area, title)} />}
      leading={
        <span className="relative shrink-0">
          <AreaCover colour={view.area.colour} className="size-16 md:size-20" />
          {view.area.icon && (
            <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-surface-inset shadow-lift">
              <AreaGlyph colour={view.area.colour} icon={view.area.icon} />
            </span>
          )}
        </span>
      }
      subtitle={`${plural(view.projects.length, "Project")}, ${plural(view.tasks.length + openInProjects, "Task")}`}
    >
      {view.tasks.length + view.projects.length === 0 && !drafting ? (
        <EmptyState title="Nothing open here" hint="Press N for a new Task, or right-click for a new Project." className="py-12" />
      ) : (
        <>
          <TaskItems tasks={view.tasks} show={{ star: true, when: true }} hostsDrafts="inline" sortable />
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

const headingSlot = (headingId: Id<"headings">) => `/heading/${headingId}`;

export const ProjectScreen = ({ projectId }: { projectId: Id<"projects"> }) => {
  const shell = useShell();
  const { today } = shell;
  const actions = useContainerActions(shell);
  const view = useView(api.planner.lists.project, { projectId });
  const drafting = useHasDrafts();
  if (view === null) return <Missing />;
  if (!view)
    return (
      <ListPage>
        <ListSkeleton />
      </ListPage>
    );
  const colour = view.area ? areaVar(view.area.colour) : "var(--brand)";
  const deadline = view.project.deadline ? deadlineMark(view.project.deadline, today) : undefined;
  const open = view.sections.reduce((sum, section) => sum + section.tasks.length, 0);
  return (
    <ListPage
      title={view.project.title}
      menu={{ "data-menu-project": projectId }}
      heading={<EditableTitle title={view.project.title} label="Project title" onSave={(title) => actions.renameProject(view.project, title)} />}
      leading={
        <span className="flex h-7 shrink-0 items-center self-start">
          <ProgressRing value={fraction(view.progress)} size={22} stroke={3} colour={colour} label={`${view.project.title} progress`}>
            <span className="sr-only">
              {view.progress.done} of {view.progress.total} done
            </span>
          </ProgressRing>
        </span>
      }
      subtitle={
        <>
          {view.area && (
            <RouteLink to={{ kind: "area", id: view.area._id }} className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:underline">
              <AreaDot colour={view.area.colour} />
              {view.area.title}
            </RouteLink>
          )}
          <span className="-mx-1.5 flex items-center gap-0.5 text-foreground">
            <WhenPicker
              when={view.project.when}
              label={whenLabel(view.project.when, today)}
              today={today}
              onChange={(when) => actions.setProjectWhen(view.project, when, today)}
            />
            <DeadlinePicker
              deadline={view.project.deadline}
              label={deadline?.label}
              overdue={deadline?.overdue}
              today={today}
              onChange={(next) => actions.setProjectDeadline(view.project, next)}
            />
          </span>
        </>
      }
      aside={
        <p className="flex h-7 shrink-0 items-baseline self-start pt-1 font-mono" aria-hidden="true">
          <RollingNumber value={view.progress.done} className="text-heading font-medium" />
          <span className="text-small text-muted-foreground">/{view.progress.total}</span>
        </p>
      }
    >
      <div className="mb-5 select-text">
        <NotesField notes={view.project.notes} onSave={(notes) => actions.setProjectNotes(view.project, notes)} />
      </div>
      {open === 0 && view.sections.length === 1 && !drafting ? (
        <EmptyState
          spot="done"
          title={view.progress.total === 0 ? "No Tasks yet" : "Every Task is done"}
          hint={view.progress.total === 0 ? "Press N to add the first Task." : "Complete the Project to send it to the Logbook."}
          action={
            view.progress.total > 0 && (
              <button
                type="button"
                onClick={() => actions.completeProject(view.project, view.project.areaId)}
                className="rounded-full bg-foreground/[0.06] px-3 py-1.5 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97]"
              >
                Complete Project
              </button>
            )
          }
          className="py-12"
        />
      ) : (
        view.sections.map((section) =>
          section.heading ? (
            <section
              key={section.heading._id}
              {...placeAttr({
                slot: headingSlot(section.heading._id),
                when: { kind: "anytime" },
                parent: { kind: "project", projectId, headingId: section.heading._id },
              })}
            >
              <SectionHeading>{section.heading.title}</SectionHeading>
              <TaskItems tasks={section.tasks} show={{ star: true, when: true }} hostsDrafts="inline" slot={headingSlot(section.heading._id)} sortable />
            </section>
          ) : (
            <TaskItems key="loose" tasks={section.tasks} show={{ star: true, when: true }} hostsDrafts="inline" sortable />
          ),
        )
      )}
    </ListPage>
  );
};

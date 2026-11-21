import { usePaginatedQuery } from "convex/react";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { UPCOMING_DAYS, dayNumber, localDate, longDay, monthLong, relativeDay, weekdayLong, whenLabel } from "@lifeos/backend/client/dates";
import type { Id } from "@lifeos/backend/dataModel";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask, TaskGroup } from "@lifeos/backend/types";
import { EmptyNote, TaskList, taskItems, type ListItem } from "@/components/task-list";
import { usePlanner } from "@/lib/kit-theme";
import type { Slot } from "@/lib/magic-plus";
import { LIST_TITLES, projectHref } from "@/lib/route";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const LOGBOOK_PAGE = 60;
const NONE: readonly ListItem[] = [];

type Tones = ReturnType<typeof usePlanner>;

const LOOSE = { kind: "loose" } as const satisfies PlannerTask["parent"];

const groupSlot = (container: TaskGroup["container"], when: PlannerTask["when"]) => {
  if (container.kind === "loose") return undefined;
  if (container.kind === "area")
    return { when, parent: { kind: "area", areaId: container.area._id }, label: container.area.title, context: container.area.title, area: container.area } satisfies Slot;
  return {
    when,
    parent: { kind: "project", projectId: container.project._id },
    label: container.project.title,
    context: container.project.title,
    project: { _id: container.project._id, title: container.project.title },
    ...(container.area ? { area: container.area } : {}),
  } satisfies Slot;
};

const groupItems = (groups: readonly TaskGroup[], tones: Tones, when: PlannerTask["when"]) =>
  groups.flatMap((group) => {
    const { container } = group;
    const tasks = taskItems(group.tasks, "when");
    if (container.kind === "loose") return tasks;
    const colour = container.area ? tones.area[container.area.colour] : undefined;
    const title = container.kind === "area" ? container.area.title : container.project.title;
    const detail = container.kind === "project" ? container.area?.title : undefined;
    const slot = groupSlot(container, when);
    return [
      { kind: "header", key: `group:${group.key}`, title, ...(detail ? { detail } : {}), ...(colour ? { colour } : {}), ...(slot ? { slot } : {}) } satisfies ListItem,
      ...tasks,
    ];
  });

const INBOX_SLOT = { when: { kind: "inbox" }, parent: LOOSE, label: "Inbox" } satisfies Slot;
const ANYTIME_SLOT = { when: { kind: "anytime" }, parent: LOOSE, label: "Anytime" } satisfies Slot;
const SOMEDAY_SLOT = { when: { kind: "someday" }, parent: LOOSE, label: "Someday" } satisfies Slot;

export const InboxScreen = () => {
  const today = useLocalDate();
  const view = useView(api.planner.lists.inbox, {});
  const items = useMemo(() => view && taskItems(view.tasks, "context"), [view]);
  return (
    <TaskList
      title={LIST_TITLES.inbox}
      items={items}
      today={today}
      slot={INBOX_SLOT}
      ordering="key"
      empty={<EmptyNote title="Inbox is clear" body="Thoughts you capture land here until you give them a place." />}
    />
  );
};

export const TodayScreen = () => {
  const today = useLocalDate();
  const view = valueOf(useView(api.planner.today.get, { date: today }));
  const slot = useMemo(() => ({ when: { kind: "scheduled", date: today, evening: false }, parent: LOOSE, label: "Today" }) satisfies Slot, [today]);
  const items = useMemo(
    () =>
      view && [
        ...taskItems(view.tasks),
        ...(view.evening.length > 0
          ? [
              {
                kind: "header",
                key: "evening",
                title: "This Evening",
                slot: { when: { kind: "scheduled", date: today, evening: true }, parent: LOOSE, label: "This Evening" },
              } satisfies ListItem,
            ]
          : []),
        ...taskItems(view.evening),
      ],
    [view, today],
  );
  return (
    <TaskList
      title={LIST_TITLES.today}
      items={items}
      today={today}
      slot={slot}
      ordering="day"
      empty={<EmptyNote title="Nothing in Today" body="Enjoy the space, or pull something in from Anytime." />}
    />
  );
};

export const UpcomingScreen = () => {
  const today = useLocalDate();
  const view = valueOf(useView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS }));
  const items = useMemo(
    () =>
      view?.days.flatMap((day) => [
        {
          kind: "header",
          key: `day:${day.date}`,
          lead: dayNumber(day.date),
          title: relativeDay(day.date, today) ?? weekdayLong(day.date),
          detail: monthLong(day.date),
          slot: {
            when: { kind: "scheduled", date: day.date, evening: false },
            parent: LOOSE,
            label: whenLabel({ kind: "scheduled", date: day.date, evening: false }, today),
          },
        } satisfies ListItem,
        ...day.deadlines
          .filter((task) => !day.tasks.some((planned) => planned._id === task._id))
          .map((task) => ({ kind: "deadline", key: `due:${day.date}:${task._id}`, task }) satisfies ListItem),
        ...taskItems(day.tasks),
      ]),
    [view, today],
  );
  return (
    <TaskList
      title={LIST_TITLES.upcoming}
      items={items}
      today={today}
      ordering="day"
      empty={<EmptyNote title="Nothing coming up" body="Swipe a Task left to give it a day." />}
    />
  );
};

export const AnytimeScreen = () => {
  const today = useLocalDate();
  const tones = usePlanner();
  const view = valueOf(useView(api.planner.lists.anytime, { date: today }));
  const items = useMemo(() => view && groupItems(view.groups, tones, ANYTIME_SLOT.when), [view, tones]);
  return (
    <TaskList
      title={LIST_TITLES.anytime}
      items={items}
      today={today}
      slot={ANYTIME_SLOT}
      ordering="key"
      empty={<EmptyNote title="Nothing in Anytime" body="Tasks without a day wait here, grouped by Area." />}
    />
  );
};

export const SomedayScreen = () => {
  const today = useLocalDate();
  const tones = usePlanner();
  const view = useView(api.planner.lists.someday, {});
  const items = useMemo(
    () =>
      view && [
        ...groupItems(view.groups, tones, SOMEDAY_SLOT.when),
        ...(view.projects.length > 0 ? [{ kind: "header", key: "projects", title: "Projects" } satisfies ListItem] : []),
        ...view.projects.map(
          (project) =>
            ({
              kind: "project",
              key: project._id,
              title: project.title,
              href: projectHref(project._id),
              done: project.progress.done,
              total: project.progress.total,
              ...(project.area ? { colour: tones.area[project.area.colour] } : {}),
            }) satisfies ListItem,
        ),
      ],
    [view, tones],
  );
  return (
    <TaskList
      title={LIST_TITLES.someday}
      items={items}
      today={today}
      slot={SOMEDAY_SLOT}
      ordering="key"
      empty={<EmptyNote title="Nothing in Someday" body="Park ideas here until their time comes." />}
    />
  );
};

export const LogbookScreen = () => {
  const today = useLocalDate();
  const { results, status, loadMore } = usePaginatedQuery(api.planner.lists.logbook, {}, { initialNumItems: LOGBOOK_PAGE });
  const items = useMemo(() => {
    if (status === "LoadingFirstPage") return undefined;
    const days = results.map((task) => (task.status.kind === "open" ? today : localDate(task.status.at)));
    return results.flatMap((task, index) => {
      const day = days[index] ?? today;
      const header = day === days[index - 1] ? [] : [{ kind: "header", key: `day:${day}`, title: relativeDay(day, today) ?? longDay(day) } satisfies ListItem];
      return [...header, { kind: "task", key: task._id, task } satisfies ListItem];
    });
  }, [results, status, today]);
  return (
    <TaskList
      title={LIST_TITLES.logbook}
      items={items}
      today={today}
      empty={<EmptyNote title="Nothing logged yet" body="Completed Tasks collect here, newest first." />}
      onEndReached={() => (status === "CanLoadMore" ? loadMore(LOGBOOK_PAGE) : undefined)}
    />
  );
};

export const AreaScreen = () => {
  const { id } = useLocalSearchParams<{ id: Id<"areas"> }>();
  const today = useLocalDate();
  const tones = usePlanner();
  const view = useView(api.planner.lists.area, { areaId: id });
  const area = view?.area;
  const slot = useMemo(
    () => area && ({ when: { kind: "anytime" }, parent: { kind: "area", areaId: area._id }, label: area.title, context: area.title, area }) satisfies Slot,
    [area],
  );
  const items = useMemo(
    () =>
      view && [
        ...taskItems(view.tasks, "when"),
        ...(view.projects.length > 0 ? [{ kind: "header", key: "projects", title: "Projects" } satisfies ListItem] : []),
        ...view.projects.map(
          (project) =>
            ({
              kind: "project",
              key: project._id,
              title: project.title,
              href: projectHref(project._id),
              done: project.progress.done,
              total: project.progress.total,
              colour: tones.area[view.area.colour],
            }) satisfies ListItem,
        ),
      ],
    [view, tones],
  );
  return (
    <TaskList
      title={view?.area.title ?? "Area"}
      items={view === null ? NONE : (items ?? undefined)}
      today={today}
      {...(slot ? { slot } : {})}
      ordering="key"
      empty={
        view === null ? (
          <EmptyNote title="This Area is gone" body="It was removed somewhere else." />
        ) : (
          <EmptyNote title="Nothing here yet" body="Capture a Task and move it to this Area." />
        )
      }
    />
  );
};

export const ProjectScreen = () => {
  const { id } = useLocalSearchParams<{ id: Id<"projects"> }>();
  const today = useLocalDate();
  const view = useView(api.planner.lists.project, { projectId: id });
  const slot = useMemo(
    () =>
      view &&
      ({
        when: { kind: "anytime" },
        parent: { kind: "project", projectId: view.project._id },
        label: view.project.title,
        context: view.project.title,
        project: { _id: view.project._id, title: view.project.title },
        ...(view.area ? { area: view.area } : {}),
      } satisfies Slot),
    [view],
  );
  const items = useMemo(
    () =>
      view?.sections.flatMap((section) => [
        ...(section.heading && slot
          ? [
              {
                kind: "header",
                key: `heading:${section.heading._id}`,
                title: section.heading.title,
                slot: { ...slot, parent: { kind: "project", projectId: view.project._id, headingId: section.heading._id } },
              } satisfies ListItem,
            ]
          : []),
        ...taskItems(section.tasks, "when"),
      ]),
    [view, slot],
  );
  const notes = view?.project.notes.trim();
  const shown = useMemo(() => items && [...(notes ? [{ kind: "note", key: "notes", text: notes } satisfies ListItem] : []), ...items], [items, notes]);
  return (
    <TaskList
      title={view?.project.title ?? "Project"}
      items={view === null ? NONE : shown}
      today={today as IsoDate}
      {...(slot ? { slot } : {})}
      ordering="key"
      empty={
        view === null ? (
          <EmptyNote title="This Project is gone" body="It was removed somewhere else." />
        ) : (
          <EmptyNote title="No Tasks left" body="Everything in this Project is done." />
        )
      }
    />
  );
};

import { useMemo, useState } from "react";
import { api } from "@lifeos/backend/api";
import { UPCOMING_DAYS } from "@lifeos/backend/client/dates";
import type { PlannerTask, SidebarView } from "@lifeos/backend/types";
import { EmptyNote, TaskList, taskItems, type ListItem } from "@/components/task-list";
import { usePlanner } from "@/lib/kit-theme";
import { areaHref, projectHref } from "@/lib/route";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const MOST = 80;

const wordsIn = (task: PlannerTask) => [task.title, task.notes, task.context ?? "", ...task.labels.map((label) => label.name)].join(" ").toLowerCase();

const matches = (words: string, wanted: readonly string[]) => wanted.every((word) => words.includes(word));

const useOpenTasks = (today: string) => {
  const inbox = useView(api.planner.lists.inbox, {});
  const day = valueOf(useView(api.planner.today.get, { date: today }));
  const upcoming = valueOf(useView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS }));
  const anytime = valueOf(useView(api.planner.lists.anytime, { date: today }));
  const someday = useView(api.planner.lists.someday, {});
  return useMemo(() => {
    const all = [
      ...(day?.tasks ?? []),
      ...(day?.evening ?? []),
      ...(inbox?.tasks ?? []),
      ...(upcoming?.days.flatMap((entry) => entry.tasks) ?? []),
      ...(anytime?.groups.flatMap((group) => group.tasks) ?? []),
      ...(someday?.groups.flatMap((group) => group.tasks) ?? []),
    ];
    return [...new Map(all.map((task) => [task._id, task] as const)).values()].map((task) => ({ task, words: wordsIn(task) }));
  }, [inbox, day, upcoming, anytime, someday]);
};

const useContainers = (today: string) => {
  const sidebar = valueOf(useView(api.planner.sidebar.get, { date: today }));
  return useMemo(() => {
    if (!sidebar) return { areas: [], projects: [] };
    const projects: { project: SidebarView["projects"][number]; area?: SidebarView["areas"][number] }[] = [
      ...sidebar.projects.map((project) => ({ project })),
      ...sidebar.areas.flatMap((area) => area.projects.map((project) => ({ project, area }))),
    ];
    return { areas: sidebar.areas, projects };
  }, [sidebar]);
};

const section = (title: string, items: readonly ListItem[]) =>
  items.length === 0 ? [] : [{ kind: "header", key: `section-${title}`, title, detail: String(items.length) } satisfies ListItem, ...items];

export const SearchScreen = () => {
  const today = useLocalDate();
  const tones = usePlanner();
  const [query, setQuery] = useState("");
  const tasks = useOpenTasks(today);
  const { areas, projects } = useContainers(today);
  const items = useMemo(() => {
    const wanted = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (wanted.length === 0) return [];
    const areaItems = areas
      .filter((area) => matches(area.title.toLowerCase(), wanted))
      .map((area) => ({ kind: "area", key: area._id, title: area.title, href: areaHref(area._id), colour: tones.area[area.colour] }) satisfies ListItem);
    const projectItems = projects
      .filter(({ project }) => matches(project.title.toLowerCase(), wanted))
      .map(
        ({ project, area }) =>
          ({
            kind: "project",
            key: project._id,
            title: project.title,
            href: projectHref(project._id),
            done: project.progress.done,
            total: project.progress.total,
            ...(area ? { colour: tones.area[area.colour] } : {}),
          }) satisfies ListItem,
      );
    const taskMatches = taskItems(
      tasks
        .filter(({ words }) => matches(words, wanted))
        .slice(0, MOST)
        .map(({ task }) => task),
      "when",
    );
    return [...section("Areas", areaItems), ...section("Projects", projectItems), ...section("Tasks", taskMatches)];
  }, [tasks, areas, projects, query, tones]);
  return (
    <TaskList
      title="Search"
      items={items}
      today={today}
      onSearch={setQuery}
      empty={
        query.trim() === "" ? (
          <EmptyNote title="Search LifeOS" body="Open Tasks by title, notes or Label, and every Project and Area by name." />
        ) : (
          <EmptyNote title="Nothing matches" body="Try fewer words, or look in the Logbook for finished Tasks." />
        )
      }
    />
  );
};

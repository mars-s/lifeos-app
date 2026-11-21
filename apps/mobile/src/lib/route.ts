import type { Href } from "expo-router";
import type { Id } from "@lifeos/backend/dataModel";

export const LISTS = ["anytime", "someday", "logbook"] as const;
export type ListKind = (typeof LISTS)[number];

export const LIST_TITLES = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  anytime: "Anytime",
  someday: "Someday",
  logbook: "Logbook",
} as const;

export const TOOLS = ["when", "deadline", "estimate", "labels", "repeat", "move"] as const;
export type Tool = (typeof TOOLS)[number];

export const listHref = (kind: ListKind) => `/lists/${kind}` as Href;
export const areaHref = (id: Id<"areas">) => ({ pathname: "/lists/area/[id]", params: { id } }) as Href;
export const projectHref = (id: Id<"projects">) => ({ pathname: "/lists/project/[id]", params: { id } }) as Href;
export const taskHref = (id: Id<"tasks">) => ({ pathname: "/task/[id]", params: { id } }) as Href;
export const toolHref = (tool: Tool, taskId: Id<"tasks">) => ({ pathname: "/tool/[tool]", params: { tool, taskId } }) as Href;

import type { Id } from "@lifeos/backend/dataModel";
import { isFeatureId, type FeatureId } from "@lifeos/backend/features";

export const LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"] as const;
export type ListKind = (typeof LISTS)[number];

export type Route =
  | { kind: ListKind }
  | { kind: "planner" }
  | { kind: "settings"; feature?: FeatureId }
  | { kind: "area"; id: Id<"areas"> }
  | { kind: "project"; id: Id<"projects"> }
  | { kind: "missing" };

export type Via = "pointer" | "keyboard";

export const PLANNER_TABS = ["planner", "upcoming"] as const;
export type PlannerTab = (typeof PLANNER_TABS)[number];

const isList = (segment: string): segment is ListKind => LISTS.some((list) => list === segment);

export const routeHref = (route: Route) => {
  if (route.kind === "area" || route.kind === "project") return `/${route.kind}?id=${route.id}`;
  if (route.kind === "settings" && route.feature) return `/settings/features/${route.feature}`;
  return route.kind === "missing" ? "/today" : `/${route.kind}`;
};

export const parseRoute = (href: string) => {
  const [path = "", query = ""] = href.split("?");
  const segment = path.replace(/^\/+|\/+$/g, "");
  const id = new URLSearchParams(query).get("id");
  if (segment === "") return { kind: "today" } satisfies Route;
  if (isList(segment)) return { kind: segment } satisfies Route;
  if (segment === "planner") return { kind: "planner" } satisfies Route;
  if (segment === "settings") return { kind: "settings" } satisfies Route;
  const feature = /^settings\/features\/([^/]+)$/.exec(segment)?.[1];
  if (feature && isFeatureId(feature)) return { kind: "settings", feature } satisfies Route;
  if (segment === "area" && id) return { kind: "area", id: id as Id<"areas"> } satisfies Route;
  if (segment === "project" && id) return { kind: "project", id: id as Id<"projects"> } satisfies Route;
  return { kind: "missing" } satisfies Route;
};

export const screenKey = (route: Route) => routeHref(route.kind === "upcoming" ? { kind: "planner" } : route);

export const sameRoute = (a: Route, b: Route) => routeHref(a) === routeHref(b) && a.kind === b.kind;

import { parseCapture, slugOf, type CaptureField } from "../capture";
import type { Id } from "../../convex/_generated/dataModel";
import type { IsoDate } from "../date";
import type { PlannerTask, SidebarView } from "../types";
import { whenLabel } from "./dates";
import { AREA_COLOURS } from "./colours";

type Label = PlannerTask["labels"][number];
type AreaSummary = NonNullable<PlannerTask["area"]>;

export type CaptureList =
  | { kind: "area"; id: Id<"areas">; title: string; area: AreaSummary }
  | { kind: "project"; id: Id<"projects">; title: string; area?: AreaSummary; done: number; total: number };

export type CaptureChip =
  | { field: "when"; token: string; when: PlannerTask["when"] }
  | { field: "deadline"; token: string; deadline: IsoDate }
  | { field: "estimate"; token: string; minutes: number }
  | { field: "label"; token: string; name: string; colour: Label["colour"]; fresh: boolean }
  | { field: "list"; token: string; list: CaptureList };

const displayName = (slug: string) => {
  const words = slug.replaceAll("-", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

const bySlug = <T,>(items: readonly T[], nameOf: (item: T) => string, slug: string) =>
  items.find((item) => slugOf(nameOf(item)) === slug) ?? items.find((item) => slugOf(nameOf(item)).startsWith(slug));

const summary = (area: SidebarView["areas"][number]) => ({ _id: area._id, title: area.title, colour: area.colour, icon: area.icon }) satisfies AreaSummary;

const project = (entry: SidebarView["projects"][number], area?: AreaSummary) =>
  ({ kind: "project", id: entry._id, title: entry.title, area, done: entry.progress.done, total: entry.progress.total }) satisfies CaptureList;

export const captureLists = (sidebar: SidebarView | undefined) => {
  if (!sidebar) return [];
  return [
    ...sidebar.projects.map((entry) => project(entry)),
    ...sidebar.areas.flatMap((area) => area.projects.map((entry) => project(entry, summary(area)))),
    ...sidebar.areas.map((area) => ({ kind: "area", id: area._id, title: area.title, area: summary(area) }) satisfies CaptureList),
  ].filter((list) => !list.id.startsWith("optimistic:"));
};

export const resolveCapture = (
  text: string,
  today: IsoDate,
  ignored: ReadonlySet<string>,
  labels: readonly Label[],
  lists: readonly CaptureList[],
) => {
  const first = parseCapture(text, today, { literal: ignored });
  const list = first.list ? bySlug(lists, (entry) => entry.title, first.list) : undefined;
  const listToken = first.tokens.find((token) => token.field === "list");
  const parsed = first.list && !list && listToken ? parseCapture(text, today, { literal: new Set([...ignored, listToken.text.toLowerCase()]) }) : first;
  const tokenOf = (field: CaptureField, index = 0) => parsed.tokens.filter((token) => token.field === field)[index]?.text.toLowerCase() ?? "";
  const known = parsed.labels.map((slug) => bySlug(labels, (label) => label.name, slug));
  const when: PlannerTask["when"] = parsed.when ?? (list ? { kind: "anytime" } : { kind: "inbox" });
  const chips: CaptureChip[] = [
    ...(parsed.when ? [{ field: "when", token: tokenOf("when"), when: parsed.when } satisfies CaptureChip] : []),
    ...(parsed.deadline ? [{ field: "deadline", token: tokenOf("deadline"), deadline: parsed.deadline } satisfies CaptureChip] : []),
    ...(parsed.estimateMinutes === undefined ? [] : [{ field: "estimate", token: tokenOf("estimate"), minutes: parsed.estimateMinutes } satisfies CaptureChip]),
    ...parsed.labels.map((slug, index) => {
      const label = known[index];
      return {
        field: "label",
        token: tokenOf("label", index),
        name: label?.name ?? displayName(slug),
        colour: label?.colour ?? AREA_COLOURS[(labels.length + index) % AREA_COLOURS.length] ?? "slate",
        fresh: !label,
      } satisfies CaptureChip;
    }),
    ...(list ? [{ field: "list", token: tokenOf("list"), list } satisfies CaptureChip] : []),
  ];
  return {
    title: parsed.title,
    when,
    deadline: parsed.deadline,
    estimateMinutes: parsed.estimateMinutes,
    labels: known.flatMap((label) => label ?? []),
    freshLabels: chips.flatMap((chip) => (chip.field === "label" && chip.fresh ? [{ name: chip.name, colour: chip.colour }] : [])),
    list,
    chips,
  };
};

export type ResolvedCapture = ReturnType<typeof resolveCapture>;

export const captureArgs = (capture: ResolvedCapture) => ({
  title: capture.title,
  when: capture.when,
  ...(capture.deadline ? { deadline: capture.deadline } : {}),
  ...(capture.estimateMinutes === undefined ? {} : { estimateMinutes: capture.estimateMinutes }),
  ...(capture.labels.length > 0 ? { labelIds: capture.labels.map((label) => label._id) } : {}),
  ...(capture.list
    ? { parent: capture.list.kind === "area" ? ({ kind: "area", areaId: capture.list.id } as const) : ({ kind: "project", projectId: capture.list.id } as const) }
    : {}),
});

export const destinationOf = (when: PlannerTask["when"], list: { title: string } | undefined, today: string) =>
  list && when.kind === "anytime" ? list.title : whenLabel(when, today);

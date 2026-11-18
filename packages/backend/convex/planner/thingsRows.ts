import { v, type Infer } from "convex/values";
import { Result, err, ok } from "neverthrow";
import { parseIsoDate } from "../../shared/date";
import {
  colours,
  vAreaBase,
  vChecklistItemBase,
  vColour,
  vHeadingBase,
  vLabelBase,
  vProjectBase,
  vTaskBase,
  type Status,
  type When,
} from "./tables";

const vNamedRow = v.object({ uuid: v.string(), title: v.string(), index: v.number() });

export const vThingsRows = v.object({
  areas: v.array(vNamedRow),
  tags: v.array(vNamedRow),
  items: v.array(
    v.object({
      uuid: v.string(),
      type: v.number(),
      title: v.string(),
      notes: v.string(),
      status: v.number(),
      trashed: v.boolean(),
      start: v.number(),
      startDate: v.union(v.number(), v.null()),
      evening: v.boolean(),
      deadline: v.union(v.number(), v.null()),
      stopDate: v.union(v.number(), v.null()),
      modifiedAt: v.union(v.number(), v.null()),
      index: v.number(),
      todayIndex: v.number(),
      area: v.union(v.string(), v.null()),
      project: v.union(v.string(), v.null()),
      heading: v.union(v.string(), v.null()),
      repeating: v.boolean(),
      tags: v.array(v.string()),
    }),
  ),
  checklistItems: v.array(
    v.object({ uuid: v.string(), task: v.string(), title: v.string(), status: v.number(), index: v.number() }),
  ),
});

export const vThingsParent = v.union(
  v.object({ kind: v.literal("loose") }),
  v.object({ kind: v.literal("area"), area: v.string() }),
  v.object({ kind: v.literal("project"), project: v.string(), heading: v.optional(v.string()) }),
);

export const vIncomingArea = vAreaBase.extend({ uuid: v.string(), colour: vColour });
export const vIncomingLabel = vLabelBase.extend({ uuid: v.string() });
export const vIncomingProject = vProjectBase
  .omit("areaId", "labelIds")
  .extend({ uuid: v.string(), area: v.optional(v.string()), tags: v.array(v.string()) });
export const vIncomingHeading = vHeadingBase.omit("projectId").extend({ uuid: v.string(), project: v.string() });
export const vIncomingTask = vTaskBase
  .omit("parent", "labelIds")
  .extend({ uuid: v.string(), todayIndex: v.number(), parent: vThingsParent, tags: v.array(v.string()) });
export const vIncomingChecklistItem = vChecklistItemBase.extend({ uuid: v.string(), task: v.string() });

export const vSkipReason = v.union(
  v.literal("repeating_template"),
  v.literal("invalid_date"),
  v.literal("unknown_status"),
  v.literal("unknown_type"),
  v.literal("unknown_start"),
  v.literal("missing_parent"),
);

export const vSkipped = v.object({ uuid: v.string(), title: v.string(), reason: vSkipReason });

export type ThingsRows = Infer<typeof vThingsRows>;
export type ThingsParent = Infer<typeof vThingsParent>;
export type IncomingArea = Infer<typeof vIncomingArea>;
export type IncomingLabel = Infer<typeof vIncomingLabel>;
export type IncomingProject = Infer<typeof vIncomingProject>;
export type IncomingHeading = Infer<typeof vIncomingHeading>;
export type IncomingTask = Infer<typeof vIncomingTask>;
export type IncomingChecklistItem = Infer<typeof vIncomingChecklistItem>;
export type SkipReason = Infer<typeof vSkipReason>;
export type Skipped = Infer<typeof vSkipped>;

type Item = ThingsRows["items"][number];

const TO_DO = 0;
const PROJECT = 1;
const HEADING = 2;
const STARTS = ["inbox", "anytime", "someday"] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const unpackDate = (packed: number) => {
  const year = packed >> 16;
  const month = (packed >> 12) & 15;
  const day = (packed >> 7) & 31;
  return parseIsoDate(`${pad(year, 4)}-${pad(month)}-${pad(day)}`).mapErr<SkipReason>(() => "invalid_date");
};

const msFrom = (seconds: number | null) => Math.round((seconds ?? 0) * 1000);

const whenOf = (item: Item) => {
  const { startDate, evening } = item;
  if (startDate !== null) return unpackDate(startDate).map<When>((date) => ({ kind: "scheduled", date, evening }));
  const kind = STARTS[item.start];
  return kind ? ok<When, SkipReason>({ kind }) : err<When, SkipReason>("unknown_start");
};

const deadlineOf = (item: Item) =>
  item.deadline === null
    ? ok<{ deadline?: string }, SkipReason>({})
    : unpackDate(item.deadline).map<{ deadline?: string }>((deadline) => ({ deadline }));

const statusOf = (item: Item) => {
  const at = msFrom(item.stopDate ?? item.modifiedAt);
  if (item.status === 0) return ok<Status, SkipReason>({ kind: "open" });
  if (item.status === 2) return ok<Status, SkipReason>({ kind: "canceled", at });
  if (item.status === 3) return ok<Status, SkipReason>({ kind: "completed", at });
  return err<Status, SkipReason>("unknown_status");
};

const commonFields = (item: Item) =>
  Result.combine([whenOf(item), deadlineOf(item), statusOf(item)]).map(([when, deadline, status]) => ({
    title: item.title,
    notes: item.notes,
    when,
    ...deadline,
    status,
    ...(item.trashed ? { trashedAt: msFrom(item.modifiedAt) } : {}),
    tags: item.tags,
  }));

const parentOf = (item: Item, headingProjects: ReadonlyMap<string, string>) => {
  const headingProject = item.heading === null ? undefined : headingProjects.get(item.heading);
  if (item.heading !== null && headingProject !== undefined) {
    return { kind: "project", project: headingProject, heading: item.heading } satisfies ThingsParent;
  }
  if (item.project !== null) return { kind: "project", project: item.project } satisfies ThingsParent;
  if (item.area !== null) return { kind: "area", area: item.area } satisfies ThingsParent;
  return { kind: "loose" } satisfies ThingsParent;
};

const byIndex = <T extends { index: number }>(rows: readonly T[]) => rows.toSorted((a, b) => a.index - b.index);

export const fromThingsRows = (rows: ThingsRows) => {
  const skipped: Skipped[] = [];
  const skip = (row: { uuid: string; title: string }, reason: SkipReason) =>
    skipped.push({ uuid: row.uuid, title: row.title, reason });
  const projects: IncomingProject[] = [];
  const headings: IncomingHeading[] = [];
  const tasks: IncomingTask[] = [];
  const headingProjects = new Map(
    rows.items.flatMap((item) => (item.type === HEADING && item.project !== null ? [[item.uuid, item.project] as const] : [])),
  );

  for (const item of byIndex(rows.items)) {
    if (item.repeating) {
      skip(item, "repeating_template");
    } else if (item.type === HEADING) {
      if (item.project === null) skip(item, "missing_parent");
      else headings.push({ uuid: item.uuid, title: item.title, project: item.project });
    } else if (item.type === PROJECT) {
      commonFields(item).match(
        (fields) => projects.push({ uuid: item.uuid, ...fields, ...(item.area === null ? {} : { area: item.area }) }),
        (reason) => skip(item, reason),
      );
    } else if (item.type === TO_DO) {
      commonFields(item).match(
        (fields) =>
          tasks.push({ uuid: item.uuid, ...fields, todayIndex: item.todayIndex, parent: parentOf(item, headingProjects) }),
        (reason) => skip(item, reason),
      );
    } else {
      skip(item, "unknown_type");
    }
  }

  const taskIds = new Set(tasks.map((task) => task.uuid));
  const checklistItems: IncomingChecklistItem[] = [];
  for (const row of byIndex(rows.checklistItems)) {
    if (taskIds.has(row.task)) checklistItems.push({ uuid: row.uuid, task: row.task, title: row.title, done: row.status !== 0 });
    else skip(row, "missing_parent");
  }

  return {
    areas: byIndex(rows.areas).map(
      ({ uuid, title }, position) =>
        ({ uuid, title, colour: colours[position % colours.length] ?? "slate" }) satisfies IncomingArea,
    ),
    labels: byIndex(rows.tags).map(({ uuid, title }) => ({ uuid, name: title }) satisfies IncomingLabel),
    projects,
    headings,
    tasks,
    checklistItems,
    skipped,
  };
};

export type Incoming = ReturnType<typeof fromThingsRows>;

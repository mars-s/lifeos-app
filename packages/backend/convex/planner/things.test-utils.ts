import type { Infer } from "convex/values";
import type { vThingsSnapshot } from "./things";
import type { vThingsRows } from "./thingsRows";

type Snapshot = Infer<typeof vThingsSnapshot>;
type SnapshotTask = Snapshot["tasks"][number];

export const thingsTask = (thingsId: string, title: string, fields: Partial<SnapshotTask> = {}) =>
  ({
    thingsId,
    title,
    notes: "",
    status: "open",
    when: { kind: "anytime" },
    tags: [],
    list: "anytime",
    index: 0,
    modifiedAt: 1,
    ...fields,
  }) satisfies SnapshotTask;

export const snapshotOf = (snapshot: Partial<Snapshot>) =>
  ({ areas: [], projects: [], tasks: [], trash: [], ...snapshot }) satisfies Snapshot;

type Rows = Infer<typeof vThingsRows>;
type ItemRow = Rows["items"][number];

export const packDate = (date: string) => {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  return (year << 16) | (month << 12) | (day << 7);
};

export const thingsItem = (uuid: string, title: string, fields: Partial<ItemRow> = {}) =>
  ({
    uuid,
    type: 0,
    title,
    notes: "",
    status: 0,
    trashed: false,
    start: 1,
    startDate: null,
    evening: false,
    deadline: null,
    stopDate: null,
    modifiedAt: 1_700_000_000,
    index: 0,
    todayIndex: 0,
    area: null,
    project: null,
    heading: null,
    repeating: false,
    tags: [],
    ...fields,
  }) satisfies ItemRow;

export const thingsProject = (uuid: string, title: string, fields: Partial<ItemRow> = {}) =>
  thingsItem(uuid, title, { type: 1, ...fields });

export const thingsHeading = (uuid: string, title: string, project: string, fields: Partial<ItemRow> = {}) =>
  thingsItem(uuid, title, { type: 2, project, ...fields });

export const rowsOf = (rows: Partial<Rows>) => ({ areas: [], tags: [], items: [], checklistItems: [], ...rows }) satisfies Rows;

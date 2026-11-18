import type { Infer } from "convex/values";
import type { vThingsSnapshot } from "./things";

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

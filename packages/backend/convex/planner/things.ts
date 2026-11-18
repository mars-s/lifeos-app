import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { startRecording, type Recorder } from "../platform/activity";
import { workerWith } from "../platform/workers";
import { parseIsoDate } from "../../shared/date";
import { keyAfter, lastTaskOrder } from "./model";
import { colours, vThingsList, vWhen, type Parent, type Status, type When } from "./tables";

const vThingsStatus = v.union(v.literal("open"), v.literal("completed"), v.literal("canceled"));

export const vThingsSnapshot = v.object({
  areas: v.array(v.object({ thingsId: v.string(), title: v.string(), index: v.number() })),
  projects: v.array(
    v.object({
      thingsId: v.string(),
      title: v.string(),
      notes: v.string(),
      status: vThingsStatus,
      when: vWhen,
      deadline: v.optional(v.string()),
      tags: v.array(v.string()),
      areaThingsId: v.optional(v.string()),
      index: v.number(),
      modifiedAt: v.number(),
    }),
  ),
  tasks: v.array(
    v.object({
      thingsId: v.string(),
      title: v.string(),
      notes: v.string(),
      status: vThingsStatus,
      when: vWhen,
      deadline: v.optional(v.string()),
      tags: v.array(v.string()),
      projectThingsId: v.optional(v.string()),
      areaThingsId: v.optional(v.string()),
      list: vThingsList,
      index: v.number(),
      modifiedAt: v.number(),
    }),
  ),
  trash: v.array(v.string()),
});

export type ThingsSnapshot = Infer<typeof vThingsSnapshot>;
type ThingsStatus = Infer<typeof vThingsStatus>;
type Counts = { inserted: number; updated: number; departed: number };

const DEPARTURE_SCAN_LIMIT = 5000;

const emptyCounts = () => ({ inserted: 0, updated: 0, departed: 0 }) satisfies Counts;

const statusFrom = (incoming: ThingsStatus, current: Status | undefined, at: number) =>
  incoming === "open"
    ? ({ kind: "open" } satisfies Status)
    : current?.kind === incoming
      ? current
      : ({ kind: incoming, at } satisfies Status);

const whenFrom = (incoming: When, current: When | undefined) =>
  incoming.kind === "scheduled" && current?.kind === "scheduled" && current.date === incoming.date
    ? { ...incoming, evening: current.evening }
    : incoming;

const departureFor = (thingsId: string, trash: ReadonlySet<string>, now: number) =>
  trash.has(thingsId) ? { trashedAt: now } : { status: { kind: "completed" as const, at: now } };

const linkedIds = (ctx: MutationCtx) => {
  const areas = new Map<string, Id<"areas"> | undefined>();
  const projects = new Map<string, Id<"projects"> | undefined>();
  const area = async (thingsId: string | undefined) => {
    if (!thingsId) return undefined;
    if (!areas.has(thingsId)) {
      const found = await ctx.db
        .query("areas")
        .withIndex("by_things_id", (q) => q.eq("things.id", thingsId))
        .unique();
      areas.set(thingsId, found?._id);
    }
    return areas.get(thingsId);
  };
  const project = async (thingsId: string | undefined) => {
    if (!thingsId) return undefined;
    if (!projects.has(thingsId)) {
      const found = await ctx.db
        .query("projects")
        .withIndex("by_things_id", (q) => q.eq("things.id", thingsId))
        .unique();
      projects.set(thingsId, found?._id);
    }
    return projects.get(thingsId);
  };
  return { area, project };
};

const syncLabels = async (ctx: MutationCtx, record: Recorder, names: Iterable<string>) => {
  const ids = new Map<string, Id<"labels">>();
  for (const name of new Set(names)) {
    const existing = await ctx.db
      .query("labels")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (existing) {
      ids.set(name, existing._id);
      continue;
    }
    const last = await ctx.db.query("labels").withIndex("by_order").order("desc").first();
    ids.set(name, await record.insert("labels", { name, colour: "slate", order: keyAfter(last?.order) }));
  }
  return (tags: string[]) => tags.flatMap((tag) => ids.get(tag) ?? []);
};

const syncAreas = async (ctx: MutationCtx, record: Recorder, snapshot: ThingsSnapshot, now: number) => {
  const counts = emptyCounts();
  const seen = new Set<string>();
  for (const area of snapshot.areas) {
    seen.add(area.thingsId);
    const link = { id: area.thingsId, index: area.index };
    const existing = await ctx.db
      .query("areas")
      .withIndex("by_things_id", (q) => q.eq("things.id", area.thingsId))
      .unique();
    if (!existing) {
      const last = await ctx.db.query("areas").withIndex("by_order").order("desc").first();
      await record.insert("areas", {
        title: area.title,
        colour: colours[area.index % colours.length] ?? "slate",
        order: keyAfter(last?.order),
        things: link,
      });
      counts.inserted += 1;
      continue;
    }
    if (await record.patch("areas", existing._id, { title: area.title, trashedAt: undefined })) counts.updated += 1;
    if (existing.things?.index !== link.index) await ctx.db.patch("areas", existing._id, { things: link });
  }
  for (const area of await ctx.db.query("areas").take(DEPARTURE_SCAN_LIMIT)) {
    if (!area.things || seen.has(area.things.id) || area.trashedAt !== undefined) continue;
    await record.patch("areas", area._id, { trashedAt: now });
    counts.departed += 1;
  }
  return counts;
};

const syncProjects = async (
  ctx: MutationCtx,
  record: Recorder,
  snapshot: ThingsSnapshot,
  ids: ReturnType<typeof linkedIds>,
  labelsFor: (tags: string[]) => Id<"labels">[],
  now: number,
) => {
  const counts = emptyCounts();
  const seen = new Set<string>();
  const trash = new Set(snapshot.trash);
  for (const project of snapshot.projects.filter(({ thingsId }) => !trash.has(thingsId))) {
    seen.add(project.thingsId);
    const link = { id: project.thingsId, index: project.index };
    const areaId = await ids.area(project.areaThingsId);
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_things_id", (q) => q.eq("things.id", project.thingsId))
      .unique();
    const owned = {
      title: project.title,
      notes: project.notes,
      areaId,
      when: whenFrom(project.when, existing?.when),
      deadline: project.deadline,
      labelIds: labelsFor(project.tags),
      status: statusFrom(project.status, existing?.status, project.modifiedAt),
      trashedAt: undefined,
    };
    if (!existing) {
      const last = await ctx.db
        .query("projects")
        .withIndex("by_area_order", (q) => q.eq("areaId", areaId))
        .order("desc")
        .first();
      const { areaId: _area, deadline: _deadline, trashedAt: _trashed, ...required } = owned;
      await record.insert("projects", {
        ...required,
        ...(areaId ? { areaId } : {}),
        ...(project.deadline ? { deadline: project.deadline } : {}),
        order: keyAfter(last?.order),
        things: link,
      });
      counts.inserted += 1;
      continue;
    }
    if (await record.patch("projects", existing._id, owned)) counts.updated += 1;
    if (existing.things?.index !== link.index) await ctx.db.patch("projects", existing._id, { things: link });
  }
  for (const project of await ctx.db.query("projects").take(DEPARTURE_SCAN_LIMIT)) {
    if (!project.things || seen.has(project.things.id)) continue;
    if (project.status.kind !== "open" || project.trashedAt !== undefined) continue;
    await record.patch("projects", project._id, departureFor(project.things.id, trash, now));
    counts.departed += 1;
  }
  return counts;
};

const parentFrom = async (
  task: ThingsSnapshot["tasks"][number],
  ids: ReturnType<typeof linkedIds>,
  current: Parent | undefined,
) => {
  const projectId = await ids.project(task.projectThingsId);
  if (projectId) {
    const headingId = current?.kind === "project" && current.projectId === projectId ? current.headingId : undefined;
    return { kind: "project", projectId, ...(headingId ? { headingId } : {}) } satisfies Parent;
  }
  const areaId = await ids.area(task.areaThingsId);
  return areaId ? ({ kind: "area", areaId } satisfies Parent) : ({ kind: "loose" } satisfies Parent);
};

const syncTasks = async (
  ctx: MutationCtx,
  record: Recorder,
  snapshot: ThingsSnapshot,
  ids: ReturnType<typeof linkedIds>,
  labelsFor: (tags: string[]) => Id<"labels">[],
  now: number,
) => {
  const counts = emptyCounts();
  const seen = new Set<string>();
  const trash = new Set(snapshot.trash);
  for (const task of snapshot.tasks.filter(({ thingsId }) => !trash.has(thingsId))) {
    seen.add(task.thingsId);
    const link = { id: task.thingsId, list: task.list, index: task.index, modifiedAt: task.modifiedAt };
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_things_id", (q) => q.eq("things.id", task.thingsId))
      .unique();
    const owned = {
      title: task.title,
      notes: task.notes,
      when: whenFrom(task.when, existing?.when),
      deadline: task.deadline,
      parent: await parentFrom(task, ids, existing?.parent),
      labelIds: labelsFor(task.tags),
      status: statusFrom(task.status, existing?.status, task.modifiedAt),
      trashedAt: undefined,
    };
    if (!existing) {
      const { deadline, trashedAt: _trashed, ...required } = owned;
      await record.insert("tasks", {
        ...required,
        ...(deadline ? { deadline } : {}),
        order: keyAfter(await lastTaskOrder(ctx, owned.parent)),
        things: link,
      });
      counts.inserted += 1;
      continue;
    }
    if (await record.patch("tasks", existing._id, owned)) counts.updated += 1;
    const sameLink =
      existing.things?.list === link.list &&
      existing.things.index === link.index &&
      existing.things.modifiedAt === link.modifiedAt;
    if (!sameLink) await ctx.db.patch("tasks", existing._id, { things: link });
  }
  const open = await ctx.db
    .query("tasks")
    .withIndex("by_trashed_status_when", (q) => q.eq("trashedAt", undefined).eq("status.kind", "open"))
    .take(DEPARTURE_SCAN_LIMIT);
  for (const task of open) {
    if (!task.things || seen.has(task.things.id)) continue;
    await record.patch("tasks", task._id, departureFor(task.things.id, trash, now));
    counts.departed += 1;
  }
  return counts;
};

const datesOf = (snapshot: ThingsSnapshot) =>
  [...snapshot.projects, ...snapshot.tasks].flatMap(({ when, deadline }) => [
    ...(when.kind === "scheduled" ? [when.date] : []),
    ...(deadline ? [deadline] : []),
  ]);

const assertSensible = async (ctx: MutationCtx, snapshot: ThingsSnapshot) => {
  const badDate = datesOf(snapshot).find((date) => parseIsoDate(date).isErr());
  if (badDate !== undefined) throw new ConvexError(`This Things snapshot has an invalid date: ${badDate}.`);
  const previous = await ctx.db.query("thingsSync").first();
  const wasMirroring = previous !== null && previous.counts.areas + previous.counts.tasks > 0;
  if (wasMirroring && snapshot.areas.length + snapshot.tasks.length === 0) {
    throw new ConvexError("This Things snapshot is empty, so nothing was changed. Check that Things is open.");
  }
};

const applySnapshot = async (ctx: MutationCtx, snapshot: ThingsSnapshot) => {
  await assertSensible(ctx, snapshot);
  const now = Date.now();
  const record = startRecording(ctx, { kind: "things" }, "things.snapshot");
  const ids = linkedIds(ctx);
  const labelsFor = await syncLabels(ctx, record, [
    ...snapshot.projects.flatMap((project) => project.tags),
    ...snapshot.tasks.flatMap((task) => task.tags),
  ]);
  const areas = await syncAreas(ctx, record, snapshot, now);
  const projects = await syncProjects(ctx, record, snapshot, ids, labelsFor, now);
  const tasks = await syncTasks(ctx, record, snapshot, ids, labelsFor, now);
  await record.finish();
  const state = {
    syncedAt: now,
    counts: { areas: snapshot.areas.length, projects: snapshot.projects.length, tasks: snapshot.tasks.length },
  };
  const previous = await ctx.db.query("thingsSync").first();
  if (previous) await ctx.db.replace("thingsSync", previous._id, state);
  else await ctx.db.insert("thingsSync", state);
  return { areas, projects, tasks };
};

export const sync = mutation({
  args: { token: v.string(), snapshot: vThingsSnapshot },
  handler: async (ctx, { token, snapshot }) => {
    await workerWith(ctx, token, "things");
    return applySnapshot(ctx, snapshot);
  },
});

export const status = query({
  args: {},
  handler: (ctx) => ctx.db.query("thingsSync").first(),
});

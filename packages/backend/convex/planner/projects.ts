import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Result, err, ok } from "neverthrow";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { Recorder } from "../platform/activity";
import { changeMutation } from "../platform/change";
import { closeProjectTasks, lastProjectOrder, reopenProjectTasks, restoreProject, trashProject } from "./containers";
import { endFocusOnClosedTask } from "./focus";
import { keyAfter, load, parseDeadline, parseOrder, parseTitle, parseWhen, type PlannerError } from "./model";
import { vWhen } from "./tables";

type ProjectFields = Partial<WithoutSystemFields<Doc<"projects">>>;
type Changed = { changed: boolean };

const parseArea = async (ctx: MutationCtx, areaId: Id<"areas"> | null) =>
  areaId === null
    ? ok<Id<"areas"> | undefined, PlannerError>(undefined)
    : (await load(ctx, "areas", areaId)).andThen((area) => ok<Id<"areas"> | undefined, PlannerError>(area._id));

const edit = async (
  ctx: MutationCtx,
  record: Recorder,
  projectId: Id<"projects">,
  fields: Result<ProjectFields, PlannerError>,
) => {
  const valid = Result.combine([await load(ctx, "projects", projectId), fields]);
  if (valid.isErr()) return err<Changed, PlannerError>(valid.error);
  return ok<Changed, PlannerError>({ changed: await record.patch("projects", projectId, valid.value[1]) });
};

export const create = changeMutation({
  action: "project.create",
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    areaId: v.optional(v.id("areas")),
    when: v.optional(vWhen),
    deadline: v.optional(v.string()),
  },
  handler: async (ctx, args, record) => {
    const fields = Result.combine([
      parseTitle(args.title),
      await parseArea(ctx, args.areaId ?? null),
      parseWhen(args.when ?? { kind: "anytime" }),
      parseDeadline(args.deadline ?? null),
    ]);
    if (fields.isErr()) return err<{ projectId: Id<"projects"> }, PlannerError>(fields.error);
    const [title, areaId, when, deadline] = fields.value;
    const projectId = await record.insert("projects", {
      title,
      notes: args.notes ?? "",
      ...(areaId ? { areaId } : {}),
      when,
      ...(deadline ? { deadline } : {}),
      labelIds: [],
      status: { kind: "open" },
      order: keyAfter(await lastProjectOrder(ctx, areaId)),
    });
    return ok<{ projectId: Id<"projects"> }, PlannerError>({ projectId });
  },
});

export const rename = changeMutation({
  action: "project.rename",
  args: { projectId: v.id("projects"), title: v.string() },
  handler: (ctx, { projectId, title }, record) =>
    edit(ctx, record, projectId, parseTitle(title).map((valid) => ({ title: valid }))),
});

export const setNotes = changeMutation({
  action: "project.setNotes",
  args: { projectId: v.id("projects"), notes: v.string() },
  handler: (ctx, { projectId, notes }, record) => edit(ctx, record, projectId, ok({ notes })),
});

export const setWhen = changeMutation({
  action: "project.setWhen",
  args: { projectId: v.id("projects"), when: vWhen },
  handler: (ctx, { projectId, when }, record) => edit(ctx, record, projectId, parseWhen(when).map((valid) => ({ when: valid }))),
});

export const setDeadline = changeMutation({
  action: "project.setDeadline",
  args: { projectId: v.id("projects"), deadline: v.union(v.string(), v.null()) },
  handler: (ctx, { projectId, deadline }, record) =>
    edit(ctx, record, projectId, parseDeadline(deadline).map((valid) => ({ deadline: valid }))),
});

export const move = changeMutation({
  action: "project.move",
  args: { projectId: v.id("projects"), areaId: v.union(v.id("areas"), v.null()), order: v.optional(v.string()) },
  handler: async (ctx, { projectId, areaId, order }, record) => {
    const area = await parseArea(ctx, areaId);
    if (area.isErr()) return err<Changed, PlannerError>(area.error);
    const key = order === undefined ? ok<string, PlannerError>(keyAfter(await lastProjectOrder(ctx, area.value))) : parseOrder(order);
    return edit(ctx, record, projectId, key.map((valid) => ({ areaId: area.value, order: valid })));
  },
});

export const complete = changeMutation({
  action: "project.complete",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, record) =>
    (await load(ctx, "projects", projectId)).asyncMap(async (project) => {
      if (project.status.kind !== "open") return { changed: false };
      const at = Date.now();
      await record.patch("projects", projectId, { status: { kind: "completed", at } });
      await closeProjectTasks(ctx, record, projectId, at);
      await endFocusOnClosedTask(ctx, record, at);
      return { changed: true };
    }),
});

export const reopen = changeMutation({
  action: "project.reopen",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, record) =>
    (await load(ctx, "projects", projectId)).asyncMap(async (project) => {
      if (project.status.kind === "open") return { changed: false };
      await record.patch("projects", projectId, { status: { kind: "open" } });
      await reopenProjectTasks(ctx, record, projectId, project.status.at);
      return { changed: true };
    }),
});

export const trash = changeMutation({
  action: "project.trash",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, record) =>
    (await load(ctx, "projects", projectId)).asyncMap(async (project) => {
      const at = Date.now();
      await trashProject(ctx, record, project, at);
      await endFocusOnClosedTask(ctx, record, at);
      return { changed: project.trashedAt === undefined };
    }),
});

export const restore = changeMutation({
  action: "project.restore",
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, record) =>
    (await load(ctx, "projects", projectId)).asyncMap(async (project) => {
      await restoreProject(ctx, record, project);
      return { changed: project.trashedAt !== undefined };
    }),
});

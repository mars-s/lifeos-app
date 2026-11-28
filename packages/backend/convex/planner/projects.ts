import { v } from "convex/values";
import type { WithoutSystemFields } from "convex/server";
import { Clock, Effect, Result } from "effect";
import type { Doc, Id } from "../_generated/dataModel";
import { changing, reading, recording } from "../platform/effect";
import { closeProjectTasks, lastProjectOrder, reopenProjectTasks, restoreProject, trashProject } from "./containers";
import { endFocusOnClosedTask } from "./focus";
import { keyAfter, load, parseDeadline, parseOrder, parseTitle, parseWhen, plannerChange } from "./model";
import { vWhen } from "./tables";

type ProjectFields = Partial<WithoutSystemFields<Doc<"projects">>>;

const parseArea = (areaId: Id<"areas"> | null) =>
  areaId === null ? Effect.succeed(undefined) : Effect.map(load("areas", areaId), (area) => area._id);

const edit = Effect.fn("projects.edit")(function* <E>(projectId: Id<"projects">, fields: Result.Result<ProjectFields, E>) {
  yield* load("projects", projectId);
  const valid = yield* Effect.fromResult(fields);
  return { changed: yield* recording((record) => record.patch("projects", projectId, valid)) };
});

export const create = plannerChange({
  action: "project.create",
  args: {
    title: v.string(),
    notes: v.optional(v.string()),
    areaId: v.optional(v.id("areas")),
    when: v.optional(vWhen),
    deadline: v.optional(v.string()),
  },
  handler: Effect.fn("projects.create")(function* (args) {
    const [title, areaId, when, deadline] = yield* Effect.all([
      Effect.fromResult(parseTitle(args.title)),
      parseArea(args.areaId ?? null),
      Effect.fromResult(parseWhen(args.when ?? { kind: "anytime" })),
      Effect.fromResult(parseDeadline(args.deadline ?? null)),
    ]);
    const order = keyAfter(yield* reading((ctx) => lastProjectOrder(ctx, areaId)));
    const projectId = yield* recording((record) =>
      record.insert("projects", {
        title,
        notes: args.notes ?? "",
        ...(areaId ? { areaId } : {}),
        when,
        ...(deadline ? { deadline } : {}),
        labelIds: [],
        status: { kind: "open" },
        order,
      }),
    );
    return { projectId };
  }),
});

export const rename = plannerChange({
  action: "project.rename",
  args: { projectId: v.id("projects"), title: v.string() },
  handler: ({ projectId, title }) => edit(projectId, Result.map(parseTitle(title), (valid) => ({ title: valid }))),
});

export const setNotes = plannerChange({
  action: "project.setNotes",
  args: { projectId: v.id("projects"), notes: v.string() },
  handler: ({ projectId, notes }) => edit(projectId, Result.succeed({ notes })),
});

export const setWhen = plannerChange({
  action: "project.setWhen",
  args: { projectId: v.id("projects"), when: vWhen },
  handler: ({ projectId, when }) => edit(projectId, Result.map(parseWhen(when), (valid) => ({ when: valid }))),
});

export const setDeadline = plannerChange({
  action: "project.setDeadline",
  args: { projectId: v.id("projects"), deadline: v.union(v.string(), v.null()) },
  handler: ({ projectId, deadline }) => edit(projectId, Result.map(parseDeadline(deadline), (valid) => ({ deadline: valid }))),
});

export const move = plannerChange({
  action: "project.move",
  args: { projectId: v.id("projects"), areaId: v.union(v.id("areas"), v.null()), order: v.optional(v.string()) },
  handler: Effect.fn("projects.move")(function* ({ projectId, areaId, order }) {
    const area = yield* parseArea(areaId);
    const key = order === undefined ? Result.succeed(keyAfter(yield* reading((ctx) => lastProjectOrder(ctx, area)))) : parseOrder(order);
    return yield* edit(projectId, Result.map(key, (valid) => ({ areaId: area, order: valid })));
  }),
});

export const complete = plannerChange({
  action: "project.complete",
  args: { projectId: v.id("projects") },
  handler: Effect.fn("projects.complete")(function* ({ projectId }) {
    const project = yield* load("projects", projectId);
    if (project.status.kind !== "open") return { changed: false };
    const at = yield* Clock.currentTimeMillis;
    yield* recording((record) => record.patch("projects", projectId, { status: { kind: "completed", at } }));
    yield* changing(async (ctx, record) => {
      await closeProjectTasks(ctx, record, projectId, at);
      await endFocusOnClosedTask(ctx, record, at);
    });
    return { changed: true };
  }),
});

export const reopen = plannerChange({
  action: "project.reopen",
  args: { projectId: v.id("projects") },
  handler: Effect.fn("projects.reopen")(function* ({ projectId }) {
    const project = yield* load("projects", projectId);
    const status = project.status;
    if (status.kind === "open") return { changed: false };
    yield* recording((record) => record.patch("projects", projectId, { status: { kind: "open" } }));
    const now = yield* Clock.currentTimeMillis;
    yield* changing((ctx, record) => reopenProjectTasks(ctx, record, projectId, status.at, now));
    return { changed: true };
  }),
});

export const trash = plannerChange({
  action: "project.trash",
  args: { projectId: v.id("projects") },
  handler: Effect.fn("projects.trash")(function* ({ projectId }) {
    const project = yield* load("projects", projectId);
    const at = yield* Clock.currentTimeMillis;
    yield* trashProject(project, at);
    yield* changing((ctx, record) => endFocusOnClosedTask(ctx, record, at));
    return { changed: project.trashedAt === undefined };
  }),
});

export const restore = plannerChange({
  action: "project.restore",
  args: { projectId: v.id("projects") },
  handler: Effect.fn("projects.restore")(function* ({ projectId }) {
    const project = yield* load("projects", projectId);
    yield* restoreProject(project);
    return { changed: project.trashedAt !== undefined };
  }),
});

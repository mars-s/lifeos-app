import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id, TableNames } from "../_generated/dataModel";
import { newBackend, unwrap, type Backend } from "../backend.test-utils";

const NOW = Date.UTC(2026, 10, 29, 9, 0);
const TODAY = "2026-11-29";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const lastActivity = (t: Backend) =>
  t.run(async (ctx) => (await ctx.db.query("activity").order("desc").first())?._id ?? null);

const newest = <T extends TableNames>(t: Backend, table: T) =>
  t.run(async (ctx) => (await ctx.db.query(table).order("desc").first())!._id as Id<T>);

const looseTask = {
  title: "Gone",
  notes: "",
  when: { kind: "inbox" as const },
  parent: { kind: "loose" as const },
  labelIds: [],
  status: { kind: "open" as const },
  order: "a0",
};

const bareProject = { title: "Gone", notes: "", when: { kind: "anytime" as const }, labelIds: [], status: { kind: "open" as const }, order: "a0" };

const gone = <T extends "tasks" | "areas" | "projects" | "labels" | "checklistItems" | "templates" | "headings">(t: Backend, table: T) =>
  t.run(async (ctx) => {
    const insert = async () => {
      if (table === "tasks") return ctx.db.insert("tasks", looseTask);
      if (table === "areas") return ctx.db.insert("areas", { title: "Gone", colour: "teal", order: "a0" });
      if (table === "projects") return ctx.db.insert("projects", bareProject);
      if (table === "labels") return ctx.db.insert("labels", { name: "Gone", colour: "teal", order: "a0" });
      if (table === "templates") {
        return ctx.db.insert("templates", { title: "Gone", notes: "", labelIds: [], parent: { kind: "loose" }, checklist: [], order: "a0" });
      }
      if (table === "headings") return ctx.db.insert("headings", { projectId: await ctx.db.insert("projects", bareProject), title: "Gone", order: "a0" });
      return ctx.db.insert("checklistItems", { taskId: await ctx.db.insert("tasks", looseTask), title: "Gone", done: false, order: "a0" });
    };
    const id = await insert();
    await ctx.db.delete(id);
    return id as Id<T>;
  });

const ok = async <T extends object>(t: Backend, value: T) => ({ ok: true, value: { ...value, activityId: await lastActivity(t) } });

const unchanged = <T extends object>(value: T) => ({ ok: true, value: { ...value, activityId: null } });

const refused = (error: object) => ({ ok: false, error });

describe("Tasks on the wire", () => {
  test("create answers with the new Task and refuses in the order it always has", async () => {
    const t = await newBackend();
    const created = await t.mutation(api.planner.tasks.create, { title: "  Book the dentist  " });
    expect(created).toStrictEqual(await ok(t, { taskId: await newest(t, "tasks") }));

    const missingArea = await gone(t, "areas");
    const missingLabel = await gone(t, "labels");
    const missingHeading = await gone(t, "headings");
    expect(await t.mutation(api.planner.tasks.create, { title: " ", deadline: "nope", estimateMinutes: -1 })).toStrictEqual(
      refused({ kind: "empty_title" }),
    );
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", when: { kind: "scheduled", date: "2026-13-40", evening: false }, deadline: "nope" }),
    ).toStrictEqual(refused({ kind: "invalid_date", input: "2026-13-40" }));
    expect(await t.mutation(api.planner.tasks.create, { title: "Plan", deadline: "nope", estimateMinutes: 0 })).toStrictEqual(
      refused({ kind: "invalid_date", input: "nope" }),
    );
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", estimateMinutes: 1.5, parent: { kind: "area", areaId: missingArea } }),
    ).toStrictEqual(refused({ kind: "invalid_estimate", minutes: 1.5 }));
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", parent: { kind: "area", areaId: missingArea }, labelIds: [missingLabel] }),
    ).toStrictEqual(refused({ kind: "not_found", table: "areas", id: missingArea }));
    expect(await t.mutation(api.planner.tasks.create, { title: "Plan", labelIds: [missingLabel], order: "!" })).toStrictEqual(
      refused({ kind: "not_found", table: "labels", id: missingLabel }),
    );
    expect(await t.mutation(api.planner.tasks.create, { title: "Plan", order: "!" })).toStrictEqual(refused({ kind: "invalid_order", order: "!" }));
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", block: { start: NOW, minutes: 0, timeZone: "Australia/Sydney" } }),
    ).toStrictEqual(refused({ kind: "invalid_block", reason: "minutes" }));
    expect(await t.mutation(api.planner.tasks.create, { title: "Plan", place: { date: "never", order: [], at: 0 } })).toStrictEqual(
      refused({ kind: "invalid_plan", reason: "range" }),
    );

    const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis" }));
    const otherProject = unwrap(await t.mutation(api.planner.projects.create, { title: "Garden" })).projectId;
    const headingId = await t.run((ctx) => ctx.db.insert("headings", { projectId, title: "Method", order: "a0" }));
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", parent: { kind: "project", projectId: otherProject, headingId } }),
    ).toStrictEqual(refused({ kind: "heading_outside_project", headingId }));
    expect(
      await t.mutation(api.planner.tasks.create, { title: "Plan", parent: { kind: "project", projectId, headingId: missingHeading } }),
    ).toStrictEqual(refused({ kind: "not_found", table: "headings", id: missingHeading }));
  });

  test("rename, move, complete, trash and restore answer with changed, and refuse a missing Task", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Draft intro" }));
    const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
    const missing = await gone(t, "tasks");

    expect(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the intro" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.rename, { taskId, title: "Draft the intro" })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.tasks.rename, { taskId, title: "" })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.tasks.rename, { taskId: missing, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "tasks", id: missing }),
    );
    expect(await t.mutation(api.planner.tasks.setNotes, { taskId, notes: "Two pages." })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.setWhen, { taskId, when: { kind: "scheduled", date: "soon", evening: false } })).toStrictEqual(
      refused({ kind: "invalid_date", input: "soon" }),
    );
    expect(await t.mutation(api.planner.tasks.setDeadline, { taskId, deadline: "2026-12-01" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.setEstimate, { taskId, minutes: 100_000 })).toStrictEqual(
      refused({ kind: "invalid_estimate", minutes: 100_000 }),
    );
    const missingLabel = await gone(t, "labels");
    expect(await t.mutation(api.planner.tasks.setLabels, { taskId, labelIds: [missingLabel] })).toStrictEqual(
      refused({ kind: "not_found", table: "labels", id: missingLabel }),
    );
    expect(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "area", areaId } })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "area", areaId }, order: "!" })).toStrictEqual(
      refused({ kind: "invalid_order", order: "!" }),
    );
    const missingArea = await gone(t, "areas");
    expect(await t.mutation(api.planner.tasks.move, { taskId, parent: { kind: "area", areaId: missingArea } })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missingArea }),
    );
    expect(await t.mutation(api.planner.tasks.reorder, { taskId, order: "!" })).toStrictEqual(refused({ kind: "invalid_order", order: "!" }));
    expect(await t.mutation(api.planner.tasks.complete, { taskId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.complete, { taskId })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.tasks.uncomplete, { taskId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.complete, { taskId: missing })).toStrictEqual(refused({ kind: "not_found", table: "tasks", id: missing }));
    expect(await t.mutation(api.planner.tasks.trash, { taskId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.trash, { taskId: missing })).toStrictEqual(refused({ kind: "not_found", table: "tasks", id: missing }));
    expect(await t.mutation(api.planner.tasks.restore, { taskId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.tasks.restore, { taskId: missing })).toStrictEqual(refused({ kind: "not_found", table: "tasks", id: missing }));
    const duplicated = await t.mutation(api.planner.tasks.duplicate, { taskId });
    expect(duplicated).toStrictEqual(await ok(t, { taskId: await newest(t, "tasks") }));
    expect(await t.mutation(api.planner.tasks.duplicate, { taskId: missing })).toStrictEqual(refused({ kind: "not_found", table: "tasks", id: missing }));
  });

  test("a Selection answers with how many changed, and refuses one too large or missing", async () => {
    const t = await newBackend();
    const first = unwrap(await t.mutation(api.planner.tasks.create, { title: "One" })).taskId;
    const second = unwrap(await t.mutation(api.planner.tasks.create, { title: "Two" })).taskId;
    const { labelId } = unwrap(await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate" }));
    const missing = await gone(t, "tasks");
    const taskIds = [first, second];

    expect(await t.mutation(api.planner.selection.setWhen, { taskIds, when: { kind: "anytime" } })).toStrictEqual(await ok(t, { changed: 2 }));
    expect(await t.mutation(api.planner.selection.setWhen, { taskIds, when: { kind: "anytime" } })).toStrictEqual(unchanged({ changed: 0 }));
    expect(await t.mutation(api.planner.selection.setDeadline, { taskIds, deadline: "later" })).toStrictEqual(
      refused({ kind: "invalid_date", input: "later" }),
    );
    expect(await t.mutation(api.planner.selection.setEstimate, { taskIds, minutes: 30 })).toStrictEqual(await ok(t, { changed: 2 }));
    expect(await t.mutation(api.planner.selection.setLabel, { taskIds, labelId, on: true })).toStrictEqual(await ok(t, { changed: 2 }));
    const missingLabel = await gone(t, "labels");
    const missingArea = await gone(t, "areas");
    expect(await t.mutation(api.planner.selection.setLabel, { taskIds, labelId: missingLabel, on: true })).toStrictEqual(
      refused({ kind: "not_found", table: "labels", id: missingLabel }),
    );
    expect(await t.mutation(api.planner.selection.move, { taskIds, parent: { kind: "area", areaId: missingArea } })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missingArea }),
    );
    expect(await t.mutation(api.planner.selection.complete, { taskIds })).toStrictEqual(await ok(t, { changed: 2 }));
    expect(await t.mutation(api.planner.selection.reopen, { taskIds })).toStrictEqual(await ok(t, { changed: 2 }));
    expect(await t.mutation(api.planner.selection.trash, { taskIds: [first, missing] })).toStrictEqual(
      refused({ kind: "not_found", table: "tasks", id: missing }),
    );
    expect(await t.mutation(api.planner.selection.trash, { taskIds })).toStrictEqual(await ok(t, { changed: 2 }));
    expect(await t.mutation(api.planner.selection.restore, { taskIds })).toStrictEqual(await ok(t, { changed: 2 }));
    const tooMany = await t.run(async (ctx) => {
      const ids: Id<"tasks">[] = [];
      for (let index = 0; index < 501; index += 1) {
        ids.push(
          await ctx.db.insert("tasks", {
            title: `Task ${index}`,
            notes: "",
            when: { kind: "inbox" },
            parent: { kind: "loose" },
            labelIds: [],
            status: { kind: "open" },
            order: "a0",
          }),
        );
      }
      return ids;
    });
    expect(await t.mutation(api.planner.selection.complete, { taskIds: tooMany })).toStrictEqual(refused({ kind: "selection_too_large", limit: 500 }));
  });

  test("converting a Task answers with the Project and its Tasks", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Write the thesis" }));
    unwrap(await t.mutation(api.planner.checklist.add, { taskId, title: "Outline" }));
    const converted = await t.mutation(api.planner.convert.toProject, { taskId });
    expect(converted).toStrictEqual(await ok(t, { projectId: await newest(t, "projects"), taskIds: [await newest(t, "tasks")] }));
    const missing = await gone(t, "tasks");
    expect(await t.mutation(api.planner.convert.toProject, { taskId: missing })).toStrictEqual(refused({ kind: "not_found", table: "tasks", id: missing }));
  });
});

describe("Areas and Projects on the wire", () => {
  test("Areas answer with their id or changed, and refuse a bad title, icon, order or missing Area", async () => {
    const t = await newBackend();
    const created = await t.mutation(api.planner.areas.create, { title: "University", icon: "book" });
    const areaId = await newest(t, "areas");
    expect(created).toStrictEqual(await ok(t, { areaId }));
    const missing = await gone(t, "areas");

    expect(await t.mutation(api.planner.areas.create, { title: "", icon: "Not An Icon" })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.areas.create, { title: "Home", icon: "Not An Icon" })).toStrictEqual(
      refused({ kind: "invalid_icon", icon: "Not An Icon" }),
    );
    expect(await t.mutation(api.planner.areas.rename, { areaId, title: "Uni" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.areas.rename, { areaId: missing, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missing }),
    );
    expect(await t.mutation(api.planner.areas.rename, { areaId, title: "" })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.areas.setColour, { areaId, colour: "rose" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.areas.setIcon, { areaId, icon: "Bad" })).toStrictEqual(refused({ kind: "invalid_icon", icon: "Bad" }));
    expect(await t.mutation(api.planner.areas.setIcon, { areaId, icon: null })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.areas.reorder, { areaId, order: "!" })).toStrictEqual(refused({ kind: "invalid_order", order: "!" }));
    expect(await t.mutation(api.planner.areas.trash, { areaId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.areas.trash, { areaId })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.areas.trash, { areaId: missing })).toStrictEqual(refused({ kind: "not_found", table: "areas", id: missing }));
    expect(await t.mutation(api.planner.areas.restore, { areaId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.areas.restore, { areaId })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.areas.restore, { areaId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missing }),
    );
  });

  test("Projects answer with their id or changed, and refuse in the order they always have", async () => {
    const t = await newBackend();
    const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
    const created = await t.mutation(api.planner.projects.create, { title: "Thesis", areaId, deadline: "2026-12-20" });
    const projectId = await newest(t, "projects");
    expect(created).toStrictEqual(await ok(t, { projectId }));
    const missingArea = await gone(t, "areas");
    const missing = await gone(t, "projects");

    expect(await t.mutation(api.planner.projects.create, { title: "", areaId: missingArea })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(
      await t.mutation(api.planner.projects.create, { title: "Garden", areaId: missingArea, when: { kind: "scheduled", date: "x", evening: false } }),
    ).toStrictEqual(refused({ kind: "not_found", table: "areas", id: missingArea }));
    expect(
      await t.mutation(api.planner.projects.create, { title: "Garden", when: { kind: "scheduled", date: "x", evening: false }, deadline: "y" }),
    ).toStrictEqual(refused({ kind: "invalid_date", input: "x" }));
    expect(await t.mutation(api.planner.projects.rename, { projectId, title: "My thesis" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.rename, { projectId: missing, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "projects", id: missing }),
    );
    expect(await t.mutation(api.planner.projects.setNotes, { projectId, notes: "Chapter by chapter." })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.setWhen, { projectId, when: { kind: "someday" } })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.setDeadline, { projectId, deadline: "z" })).toStrictEqual(refused({ kind: "invalid_date", input: "z" }));
    expect(await t.mutation(api.planner.projects.setDeadline, { projectId, deadline: null })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.move, { projectId, areaId: null })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.move, { projectId, areaId: missingArea, order: "!" })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missingArea }),
    );
    expect(await t.mutation(api.planner.projects.move, { projectId, areaId, order: "!" })).toStrictEqual(refused({ kind: "invalid_order", order: "!" }));
    expect(await t.mutation(api.planner.projects.move, { projectId: missing, areaId, order: "!" })).toStrictEqual(
      refused({ kind: "not_found", table: "projects", id: missing }),
    );
    expect(await t.mutation(api.planner.projects.complete, { projectId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.complete, { projectId })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.projects.reopen, { projectId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.reopen, { projectId })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.projects.complete, { projectId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "projects", id: missing }),
    );
    expect(await t.mutation(api.planner.projects.trash, { projectId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.trash, { projectId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "projects", id: missing }),
    );
    expect(await t.mutation(api.planner.projects.restore, { projectId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.projects.restore, { projectId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "projects", id: missing }),
    );
  });
});

describe("labels and Checklist Items on the wire", () => {
  test("labels answer with their id, changed or stripped, and refuse a taken name", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "File the receipts" }));
    const created = await t.mutation(api.planner.labels.create, { name: "Admin", colour: "slate", taskId });
    const labelId = await newest(t, "labels");
    expect(created).toStrictEqual(await ok(t, { labelId }));
    expect(await t.mutation(api.planner.labels.create, { name: "admin", colour: "rose" })).toStrictEqual(unchanged({ labelId }));
    const other = unwrap(await t.mutation(api.planner.labels.create, { name: "Errand", colour: "olive" })).labelId;
    const missing = await gone(t, "labels");
    const missingTask = await gone(t, "tasks");

    expect(await t.mutation(api.planner.labels.create, { name: " ", colour: "slate", taskId: missingTask })).toStrictEqual(
      refused({ kind: "empty_title" }),
    );
    expect(await t.mutation(api.planner.labels.create, { name: "Home", colour: "slate", taskId: missingTask })).toStrictEqual(
      refused({ kind: "not_found", table: "tasks", id: missingTask }),
    );
    expect(await t.mutation(api.planner.labels.rename, { labelId: other, name: "ADMIN" })).toStrictEqual(refused({ kind: "name_taken", name: "Admin" }));
    expect(await t.mutation(api.planner.labels.rename, { labelId: missing, name: "Home" })).toStrictEqual(
      refused({ kind: "not_found", table: "labels", id: missing }),
    );
    expect(await t.mutation(api.planner.labels.rename, { labelId: missing, name: "" })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.labels.rename, { labelId: other, name: "Errands" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.labels.setColour, { labelId: other, colour: "plum" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.labels.setColour, { labelId: missing, colour: "plum" })).toStrictEqual(
      refused({ kind: "not_found", table: "labels", id: missing }),
    );
    expect(await t.mutation(api.planner.labels.remove, { labelId })).toStrictEqual(await ok(t, { stripped: 1 }));
    expect(await t.mutation(api.planner.labels.remove, { labelId: missing })).toStrictEqual(refused({ kind: "not_found", table: "labels", id: missing }));
    expect(await t.query(api.planner.labels.list, {})).toStrictEqual([{ _id: other, name: "Errands", colour: "plum" }]);
  });

  test("Checklist Items answer with their id or changed, and refuse a missing Task first", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Pack" }));
    const added = await t.mutation(api.planner.checklist.add, { taskId, title: "Charger" });
    const itemId = await newest(t, "checklistItems");
    expect(added).toStrictEqual(await ok(t, { itemId }));
    const missingTask = await gone(t, "tasks");
    const missing = await gone(t, "checklistItems");

    expect(await t.mutation(api.planner.checklist.add, { taskId: missingTask, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "tasks", id: missingTask }),
    );
    expect(await t.mutation(api.planner.checklist.add, { taskId, title: "" })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.checklist.edit, { itemId, title: "Laptop charger" })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.checklist.edit, { itemId: missing, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "checklistItems", id: missing }),
    );
    expect(await t.mutation(api.planner.checklist.edit, { itemId, title: " " })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.checklist.tick, { itemId, done: true })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.checklist.tick, { itemId, done: true })).toStrictEqual(unchanged({ changed: false }));
    expect(await t.mutation(api.planner.checklist.tick, { itemId: missing, done: true })).toStrictEqual(
      refused({ kind: "not_found", table: "checklistItems", id: missing }),
    );
    expect(await t.mutation(api.planner.checklist.reorder, { itemId, order: "!" })).toStrictEqual(refused({ kind: "invalid_order", order: "!" }));
    expect(await t.mutation(api.planner.checklist.reorder, { itemId: missing, order: "!" })).toStrictEqual(
      refused({ kind: "not_found", table: "checklistItems", id: missing }),
    );
    expect(await t.mutation(api.planner.checklist.remove, { itemId })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.checklist.remove, { itemId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "checklistItems", id: missing }),
    );
  });
});

describe("Templates on the wire", () => {
  test("Templates answer with their id or changed, and refuse bad input in order", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Weekly review", deadline: "2026-12-01" }));
    const saved = await t.mutation(api.planner.templates.saveFromTask, { taskId, today: TODAY });
    const templateId = await newest(t, "templates");
    expect(saved).toStrictEqual(await ok(t, { templateId }));
    const missingTask = await gone(t, "tasks");
    const missing = await gone(t, "templates");

    expect(await t.mutation(api.planner.templates.saveFromTask, { taskId: missingTask, today: "x" })).toStrictEqual(
      refused({ kind: "not_found", table: "tasks", id: missingTask }),
    );
    expect(await t.mutation(api.planner.templates.saveFromTask, { taskId, today: "x" })).toStrictEqual(refused({ kind: "invalid_date", input: "x" }));

    const created = await t.mutation(api.planner.templates.createTask, { templateId, when: { kind: "anytime" }, today: TODAY });
    expect(created).toStrictEqual(await ok(t, { taskId: await newest(t, "tasks") }));
    expect(
      await t.mutation(api.planner.templates.createTask, { templateId: missing, when: { kind: "scheduled", date: "x", evening: false }, today: TODAY }),
    ).toStrictEqual(refused({ kind: "not_found", table: "templates", id: missing }));
    expect(
      await t.mutation(api.planner.templates.createTask, { templateId, when: { kind: "scheduled", date: "x", evening: false }, today: "y" }),
    ).toStrictEqual(refused({ kind: "invalid_date", input: "x" }));
    expect(await t.mutation(api.planner.templates.createTask, { templateId, when: { kind: "anytime" }, today: "y" })).toStrictEqual(
      refused({ kind: "invalid_date", input: "y" }),
    );

    expect(await t.mutation(api.planner.templates.update, { templateId, title: "Review", checklist: ["Inbox"] })).toStrictEqual(
      await ok(t, { changed: true }),
    );
    expect(await t.mutation(api.planner.templates.update, { templateId: missing, title: "" })).toStrictEqual(
      refused({ kind: "not_found", table: "templates", id: missing }),
    );
    expect(await t.mutation(api.planner.templates.update, { templateId, title: "", estimateMinutes: -1 })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.templates.update, { templateId, estimateMinutes: -1, checklist: [""] })).toStrictEqual(
      refused({ kind: "invalid_estimate", minutes: -1 }),
    );
    expect(await t.mutation(api.planner.templates.update, { templateId, checklist: Array.from({ length: 101 }, () => "Step") })).toStrictEqual(
      refused({ kind: "invalid_template", reason: "checklist" }),
    );
    expect(await t.mutation(api.planner.templates.update, { templateId, checklist: ["Fine", " "] })).toStrictEqual(refused({ kind: "empty_title" }));
    expect(await t.mutation(api.planner.templates.update, { templateId, deadlineOffsetDays: 400 })).toStrictEqual(
      refused({ kind: "invalid_template", reason: "deadline_offset" }),
    );

    const second = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId, today: TODAY })).templateId;
    expect(await t.mutation(api.planner.templates.reorder, { templateId: second, targetId: templateId, placement: "before" })).toStrictEqual(
      await ok(t, { changed: true }),
    );
    expect(await t.mutation(api.planner.templates.reorder, { templateId: second, targetId: templateId, placement: "before" })).toStrictEqual(
      unchanged({ changed: false }),
    );
    expect(await t.mutation(api.planner.templates.reorder, { templateId: missing, targetId: templateId, placement: "after" })).toStrictEqual(
      refused({ kind: "not_found", table: "templates", id: missing }),
    );
    expect(await t.mutation(api.planner.templates.remove, { templateId: second })).toStrictEqual(await ok(t, { changed: true }));
    expect(await t.mutation(api.planner.templates.remove, { templateId: missing })).toStrictEqual(
      refused({ kind: "not_found", table: "templates", id: missing }),
    );
  });

  test("every Template change refuses with feature_off while Templates are switched off", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Weekly review" }));
    const { templateId } = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId, today: TODAY }));
    unwrap(await t.mutation(api.platform.features.setEnabled, { feature: "templates", enabled: false }));
    const off = refused({ kind: "feature_off", feature: "templates" });
    expect(await t.mutation(api.planner.templates.saveFromTask, { taskId, today: "x" })).toStrictEqual(off);
    expect(await t.mutation(api.planner.templates.createTask, { templateId, when: { kind: "anytime" }, today: TODAY })).toStrictEqual(off);
    expect(await t.mutation(api.planner.templates.update, { templateId, title: "" })).toStrictEqual(off);
    expect(await t.mutation(api.planner.templates.reorder, { templateId, targetId: templateId, placement: "after" })).toStrictEqual(off);
    expect(await t.mutation(api.planner.templates.remove, { templateId })).toStrictEqual(off);
  });
});

describe("Trash on the wire", () => {
  test("restore, delete forever and empty answer with counts, and refuse a missing or untrashed record", async () => {
    const t = await newBackend();
    const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Old idea" }));
    const kept = unwrap(await t.mutation(api.planner.tasks.create, { title: "Live idea" })).taskId;
    const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Old project" }));
    const missing = await gone(t, "areas");

    expect(await t.mutation(api.planner.trash.restore, { items: [{ kind: "task", id: kept }] })).toStrictEqual(
      refused({ kind: "not_trashed", table: "tasks", id: kept }),
    );
    expect(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "area", id: missing }] })).toStrictEqual(
      refused({ kind: "not_found", table: "areas", id: missing }),
    );
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId }));
    unwrap(await t.mutation(api.planner.projects.trash, { projectId }));
    expect(await t.mutation(api.planner.trash.restore, { items: [{ kind: "task", id: taskId }] })).toStrictEqual(await ok(t, { restored: 1 }));
    unwrap(await t.mutation(api.planner.tasks.trash, { taskId }));
    expect(await t.mutation(api.planner.trash.deleteForever, { items: [{ kind: "task", id: taskId }] })).toStrictEqual(await ok(t, { deleted: 1 }));
    expect(await t.mutation(api.planner.trash.empty, {})).toStrictEqual(await ok(t, { deleted: 1, done: false }));
    expect(await t.mutation(api.planner.trash.empty, {})).toStrictEqual(unchanged({ deleted: 0, done: true }));
  });
});

describe("lists on the wire", () => {
  test("Today, the Sidebar, Anytime and Upcoming answer with their view, and refuse an unreadable date", async () => {
    const t = await newBackend();
    const bad = refused({ kind: "invalid_date", input: "tomorrow" });
    expect(await t.query(api.planner.today.get, { date: TODAY })).toStrictEqual({ ok: true, value: { date: TODAY, tasks: [], evening: [] } });
    expect(await t.query(api.planner.today.get, { date: "tomorrow" })).toStrictEqual(bad);
    expect(await t.query(api.planner.sidebar.get, { date: TODAY })).toStrictEqual({
      ok: true,
      value: { counts: { inbox: 0, today: 0 }, projects: [], areas: [] },
    });
    expect(await t.query(api.planner.sidebar.get, { date: "tomorrow" })).toStrictEqual(bad);
    expect(await t.query(api.planner.lists.anytime, { date: TODAY })).toStrictEqual({ ok: true, value: { date: TODAY, groups: [] } });
    expect(await t.query(api.planner.lists.anytime, { date: "tomorrow" })).toStrictEqual(bad);
    expect(await t.query(api.planner.lists.upcoming, { date: TODAY, days: 7 })).toStrictEqual({
      ok: true,
      value: { date: TODAY, until: "2026-12-06", days: [] },
    });
    expect(await t.query(api.planner.lists.upcoming, { date: "tomorrow", days: 7 })).toStrictEqual(bad);
    expect(await t.query(api.planner.lists.inbox, {})).toStrictEqual({ tasks: [] });
    expect(await t.query(api.planner.trash.list, {})).toStrictEqual({ rows: [], truncated: false });
  });
});

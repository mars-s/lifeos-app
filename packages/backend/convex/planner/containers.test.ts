import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend, unwrap } from "../backend.test-utils";

const DATE = "2026-11-18";

const setup = async () => {
  const t = await newBackend();
  const sidebar = async () => unwrap(await t.query(api.planner.sidebar.get, { date: DATE }));
  const areaTitles = async () => (await sidebar()).areas.map((area) => area.title);
  const undo = async (activityId: Id<"activity"> | null) => unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  const card = async (taskId: Id<"tasks">) => (await t.query(api.planner.tasks.card, { taskId }))!;
  return { t, sidebar, areaTitles, undo, card };
};

test("a new Area lands last, takes the first unused colour, and undo removes it", async () => {
  const { t, sidebar, areaTitles, undo } = await setup();
  unwrap(await t.mutation(api.planner.areas.create, { title: " University " }));
  const { activityId } = unwrap(await t.mutation(api.planner.areas.create, { title: "Personal", icon: "home" }));
  expect((await sidebar()).areas.map(({ title, colour, icon }) => [title, colour, icon])).toEqual([
    ["University", "violet", undefined],
    ["Personal", "green", "home"],
  ]);
  await undo(activityId);
  expect(await areaTitles()).toEqual(["University"]);
});

test("an Area refuses an empty title and a malformed icon", async () => {
  const { t } = await setup();
  expect(await t.mutation(api.planner.areas.create, { title: "  " })).toEqual({ ok: false, error: { kind: "empty_title" } });
  expect(await t.mutation(api.planner.areas.create, { title: "Work", icon: "Not An Icon" })).toEqual({
    ok: false,
    error: { kind: "invalid_icon", icon: "Not An Icon" },
  });
});

test("rename, colour, icon and reorder each change the Area and undo", async () => {
  const { t, sidebar, areaTitles, undo } = await setup();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  unwrap(await t.mutation(api.planner.areas.create, { title: "Personal" }));
  unwrap(await t.mutation(api.planner.areas.rename, { areaId, title: "Uni" }));
  unwrap(await t.mutation(api.planner.areas.setColour, { areaId, colour: "rose" }));
  unwrap(await t.mutation(api.planner.areas.setIcon, { areaId, icon: "book" }));
  const moved = unwrap(await t.mutation(api.planner.areas.reorder, { areaId, order: "a5" }));
  expect((await sidebar()).areas.map(({ title, colour, icon }) => [title, colour, icon])).toEqual([
    ["Personal", "green", undefined],
    ["Uni", "rose", "book"],
  ]);
  await undo(moved.activityId);
  expect(await areaTitles()).toEqual(["Uni", "Personal"]);
  unwrap(await t.mutation(api.planner.areas.setIcon, { areaId, icon: null }));
  expect((await sidebar()).areas[0]?.icon).toBeUndefined();
});

test("trashing an Area takes its Projects and Tasks with it in one undo step", async () => {
  const { t, areaTitles, undo, card } = await setup();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId }));
  const inArea = unwrap(await t.mutation(api.planner.tasks.create, { title: "Enrol", parent: { kind: "area", areaId } })).taskId;
  const inProject = unwrap(
    await t.mutation(api.planner.tasks.create, { title: "Outline", parent: { kind: "project", projectId } }),
  ).taskId;
  const alreadyTrashed = unwrap(await t.mutation(api.planner.tasks.create, { title: "Old", parent: { kind: "area", areaId } })).taskId;
  unwrap(await t.mutation(api.planner.tasks.trash, { taskId: alreadyTrashed }));
  const earlier = (await card(alreadyTrashed)).trashedAt;

  const { activityId } = unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  expect(await areaTitles()).toEqual([]);
  expect(await t.query(api.planner.lists.project, { projectId })).toBeNull();
  expect((await card(inArea)).trashedAt).toEqual(expect.any(Number));
  expect((await card(inProject)).trashedAt).toEqual(expect.any(Number));

  await undo(activityId);
  expect(await areaTitles()).toEqual(["University"]);
  expect((await card(inArea)).trashedAt).toBeUndefined();
  expect((await card(inProject)).trashedAt).toBeUndefined();
  expect((await card(alreadyTrashed)).trashedAt).toBe(earlier);

  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  unwrap(await t.mutation(api.planner.areas.restore, { areaId }));
  expect(await areaTitles()).toEqual(["University"]);
  expect((await card(inProject)).trashedAt).toBeUndefined();
  expect((await card(alreadyTrashed)).trashedAt).toBe(earlier);
});

test("a Project is created loose or in an Area, and edits land on its page", async () => {
  const { t, sidebar } = await setup();
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const loose = unwrap(await t.mutation(api.planner.projects.create, { title: "Tax return" })).projectId;
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId }));
  const shape = await sidebar();
  expect(shape.projects.map((project) => project.title)).toEqual(["Tax return"]);
  expect(shape.areas[0]?.projects.map((project) => project.title)).toEqual(["Thesis"]);

  unwrap(await t.mutation(api.planner.projects.rename, { projectId, title: "Honours thesis" }));
  unwrap(await t.mutation(api.planner.projects.setNotes, { projectId, notes: "Supervisor: Dr Lin" }));
  unwrap(await t.mutation(api.planner.projects.setWhen, { projectId, when: { kind: "someday" } }));
  unwrap(await t.mutation(api.planner.projects.setDeadline, { projectId, deadline: "2026-12-20" }));
  expect((await t.query(api.planner.lists.project, { projectId }))?.project).toMatchObject({
    title: "Honours thesis",
    notes: "Supervisor: Dr Lin",
    when: { kind: "someday" },
    deadline: "2026-12-20",
    areaId,
  });
  expect(await t.mutation(api.planner.projects.setDeadline, { projectId, deadline: "20 Dec" })).toMatchObject({
    ok: false,
    error: { kind: "invalid_date" },
  });
  expect(await t.mutation(api.planner.projects.rename, { projectId: loose, title: "" })).toEqual({
    ok: false,
    error: { kind: "empty_title" },
  });
});

test("moving a Project between Areas and out of them shows in the sidebar and undoes", async () => {
  const { t, sidebar, undo } = await setup();
  const university = unwrap(await t.mutation(api.planner.areas.create, { title: "University" })).areaId;
  const personal = unwrap(await t.mutation(api.planner.areas.create, { title: "Personal" })).areaId;
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId: university }));
  unwrap(await t.mutation(api.planner.projects.create, { title: "Japan trip", areaId: personal }));
  const titles = async () => {
    const shape = await sidebar();
    return [shape.projects.map((p) => p.title), ...shape.areas.map((area) => area.projects.map((p) => p.title))];
  };

  unwrap(await t.mutation(api.planner.projects.move, { projectId, areaId: personal }));
  expect(await titles()).toEqual([[], [], ["Japan trip", "Thesis"]]);
  const loosened = unwrap(await t.mutation(api.planner.projects.move, { projectId, areaId: null }));
  expect(await titles()).toEqual([["Thesis"], [], ["Japan trip"]]);
  await undo(loosened.activityId);
  expect(await titles()).toEqual([[], [], ["Japan trip", "Thesis"]]);
});

test("completing a Project completes its open Tasks, and reopening brings back only those", async () => {
  const { t, sidebar, card, undo } = await setup();
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis" }));
  const parent = { kind: "project" as const, projectId };
  const open = unwrap(await t.mutation(api.planner.tasks.create, { title: "Outline", parent })).taskId;
  const doneEarlier = unwrap(await t.mutation(api.planner.tasks.create, { title: "Proposal", parent })).taskId;
  unwrap(await t.mutation(api.planner.tasks.complete, { taskId: doneEarlier }));
  const earlier = (await card(doneEarlier)).status;

  const { activityId } = unwrap(await t.mutation(api.planner.projects.complete, { projectId }));
  expect((await sidebar()).projects).toEqual([]);
  expect((await card(open)).status.kind).toBe("completed");
  await undo(activityId);
  expect((await sidebar()).projects.map((p) => p.title)).toEqual(["Thesis"]);
  expect((await card(open)).status).toEqual({ kind: "open" });

  unwrap(await t.mutation(api.planner.projects.complete, { projectId }));
  unwrap(await t.mutation(api.planner.projects.reopen, { projectId }));
  expect((await card(open)).status).toEqual({ kind: "open" });
  expect((await card(doneEarlier)).status).toEqual(earlier);
});

test("trashing a Project hides it and its Tasks, and restore brings both back", async () => {
  const { t, sidebar, card, undo } = await setup();
  const { projectId } = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis" }));
  const taskId = unwrap(
    await t.mutation(api.planner.tasks.create, {
      title: "Outline",
      parent: { kind: "project", projectId },
      when: { kind: "scheduled", date: DATE, evening: false },
    }),
  ).taskId;
  const todayTitles = async () => unwrap(await t.query(api.planner.today.get, { date: DATE })).tasks.map((row) => row.title);
  expect(await todayTitles()).toEqual(["Outline"]);

  const { activityId } = unwrap(await t.mutation(api.planner.projects.trash, { projectId }));
  expect((await sidebar()).projects).toEqual([]);
  expect(await todayTitles()).toEqual([]);
  await undo(activityId);
  expect(await todayTitles()).toEqual(["Outline"]);

  unwrap(await t.mutation(api.planner.projects.trash, { projectId }));
  unwrap(await t.mutation(api.planner.projects.restore, { projectId }));
  expect((await sidebar()).projects.map((p) => p.title)).toEqual(["Thesis"]);
  expect((await card(taskId)).trashedAt).toBeUndefined();
});

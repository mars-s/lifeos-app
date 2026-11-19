import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  newBackend,
  newSignedOutBackend,
  ownerGithubId,
  refusal,
  signInWithGithub,
  strangerSession,
  unwrap,
  type Backend,
} from "../backend.test-utils";

const today = "2026-11-19";

const shapedTask = async (t: Backend) => {
  const { areaId } = unwrap(await t.mutation(api.planner.areas.create, { title: "University" }));
  const { labelId } = unwrap(await t.mutation(api.planner.labels.create, { name: "Deep Work", colour: "violet" }));
  const { taskId } = unwrap(
    await t.mutation(api.planner.tasks.create, {
      title: "Weekly review",
      notes: "Look back, then ahead.",
      when: { kind: "scheduled", date: today, evening: false },
      deadline: "2026-11-21",
      estimateMinutes: 45,
      parent: { kind: "area", areaId },
      labelIds: [labelId],
    }),
  );
  for (const title of ["Clear the inbox", "Plan next week"]) unwrap(await t.mutation(api.planner.checklist.add, { taskId, title }));
  return { areaId, labelId, taskId };
};

const templates = (t: Backend) => t.query(api.planner.templates.list, {});

test("a Template saved from a Task creates independent Tasks with fresh Checklist Items", async () => {
  const t = await newBackend();
  const { areaId, labelId, taskId } = await shapedTask(t);
  const { templateId } = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId, today }));
  const [saved] = await templates(t);
  expect(saved).toMatchObject({
    _id: templateId,
    title: "Weekly review",
    notes: "Look back, then ahead.",
    estimateMinutes: 45,
    checklist: ["Clear the inbox", "Plan next week"],
    checklistCount: 2,
    deadlineOffsetDays: 2,
    labels: [{ _id: labelId, name: "Deep Work", colour: "violet" }],
    area: { _id: areaId, title: "University" },
  });

  const created = unwrap(
    await t.mutation(api.planner.templates.createTask, {
      templateId,
      when: { kind: "scheduled", date: "2026-12-01", evening: false },
      today,
    }),
  );
  const [original, copy] = await Promise.all(
    [taskId, created.taskId].map((id) => t.query(api.planner.tasks.card, { taskId: id })),
  );
  expect(copy).toMatchObject({
    title: "Weekly review",
    when: { kind: "scheduled", date: "2026-12-01", evening: false },
    deadline: "2026-12-03",
    estimateMinutes: 45,
    parent: { kind: "area", areaId },
    labelIds: [labelId],
    status: { kind: "open" },
  });
  expect(copy?.checklist.map(({ title, done }) => ({ title, done }))).toEqual([
    { title: "Clear the inbox", done: false },
    { title: "Plan next week", done: false },
  ]);
  const originalItems = new Set(original?.checklist.map((item) => item._id));
  expect(copy?.checklist.some((item) => originalItems.has(item._id))).toBe(false);

  unwrap(await t.mutation(api.planner.tasks.rename, { taskId: created.taskId, title: "Monthly review" }));
  unwrap(await t.mutation(api.planner.checklist.add, { taskId: created.taskId, title: "File receipts" }));
  expect(await templates(t)).toEqual([saved]);


  const undone = unwrap(await t.mutation(api.planner.templates.createTask, { templateId, when: { kind: "inbox" }, today }));
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: undone.activityId! }));
  expect(await t.query(api.planner.tasks.card, { taskId: undone.taskId })).toBeNull();
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("checklistItems")
        .withIndex("by_task_order", (q) => q.eq("taskId", undone.taskId))
        .collect(),
    ),
  ).toEqual([]);
});

test("a loose Template takes the given parent, and one with a trashed Area falls back to loose", async () => {
  const t = await newBackend();
  const { areaId, taskId } = await shapedTask(t);
  const { areaId: other } = unwrap(await t.mutation(api.planner.areas.create, { title: "Personal" }));
  const { taskId: looseTask } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Call home" }));
  const homed = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId, today })).templateId;
  const loose = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId: looseTask, today })).templateId;
  const create = async (templateId: Id<"templates">) =>
    unwrap(
      await t.mutation(api.planner.templates.createTask, {
        templateId,
        when: { kind: "anytime" },
        parent: { kind: "area", areaId: other },
        today,
      }),
    ).taskId;
  const parentOf = async (id: Id<"tasks">) => (await t.query(api.planner.tasks.card, { taskId: id }))?.parent;

  expect(await parentOf(await create(loose))).toEqual({ kind: "area", areaId: other });
  expect(await parentOf(await create(homed))).toEqual({ kind: "area", areaId });
  const anytime = await t.query(api.planner.tasks.card, { taskId: await create(homed) });
  expect(anytime?.deadline).toBe("2026-11-21");
  unwrap(await t.mutation(api.planner.areas.trash, { areaId }));
  expect(await parentOf(await create(homed))).toEqual({ kind: "loose" });
});

test("editing a Template validates like the Task setters, and removing one can be undone", async () => {
  const t = await newBackend();
  const { taskId } = await shapedTask(t);
  const { templateId } = unwrap(await t.mutation(api.planner.templates.saveFromTask, { taskId, today }));
  const update = (fields: Omit<Parameters<typeof t.mutation<typeof api.planner.templates.update>>[1], "templateId">) =>
    t.mutation(api.planner.templates.update, { templateId, ...fields });

  expect((await update({ title: "  " })).ok).toBe(false);
  expect(await update({ checklist: Array.from({ length: 101 }, (_, index) => `Step ${index}`) })).toEqual({
    ok: false,
    error: { kind: "invalid_template", reason: "checklist" },
  });
  expect(await update({ deadlineOffsetDays: 366 })).toEqual({
    ok: false,
    error: { kind: "invalid_template", reason: "deadline_offset" },
  });
  expect(await update({ estimateMinutes: 0 })).toEqual({ ok: false, error: { kind: "invalid_estimate", minutes: 0 } });
  expect(await update({ checklist: ["Clear the inbox", " "] })).toEqual({ ok: false, error: { kind: "empty_title" } });
  unwrap(await update({ title: " Fortnightly review ", estimateMinutes: null, checklist: [" Clear the inbox "], deadlineOffsetDays: null }));
  const [edited] = await templates(t);
  expect(edited).toMatchObject({ title: "Fortnightly review", checklist: ["Clear the inbox"] });
  expect(edited?.estimateMinutes).toBeUndefined();
  expect(edited?.deadlineOffsetDays).toBeUndefined();

  const { activityId } = unwrap(await t.mutation(api.planner.templates.remove, { templateId }));
  expect(await templates(t)).toEqual([]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: activityId! }));
  expect(await templates(t)).toEqual([expect.objectContaining({ title: "Fortnightly review", checklist: ["Clear the inbox"] })]);
});

test("a stranger or a signed-out caller cannot read or change Templates", async () => {
  const anonymous = newSignedOutBackend();
  const owner = await signInWithGithub(anonymous, ownerGithubId, "avi");
  const stranger = await strangerSession(anonymous);
  const { taskId } = unwrap(await owner.mutation(api.planner.tasks.create, { title: "Weekly review" }));
  const { templateId } = unwrap(await owner.mutation(api.planner.templates.saveFromTask, { taskId, today }));
  for (const [caller, kind] of [
    [anonymous, "signed_out"],
    [stranger, "not_owner"],
  ] as const) {
    expect(
      await Promise.all([
        refusal(caller.query(api.planner.templates.list, {})),
        refusal(caller.mutation(api.planner.templates.saveFromTask, { taskId, today })),
        refusal(caller.mutation(api.planner.templates.createTask, { templateId, when: { kind: "inbox" }, today })),
        refusal(caller.mutation(api.planner.templates.update, { templateId, title: "Mine now" })),
        refusal(caller.mutation(api.planner.templates.remove, { templateId })),
      ]),
    ).toEqual(Array.from({ length: 5 }, () => kind));
  }
  expect(await owner.query(api.planner.templates.list, {})).toEqual([expect.objectContaining({ title: "Weekly review" })]);
});

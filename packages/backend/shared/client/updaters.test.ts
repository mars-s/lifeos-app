import { describe, expect, test } from "vitest";
import type { PlannerTask } from "../types";
import { rewriteView } from "./local-views";
import { showNewTask } from "./updaters";

const TODAY = "2026-11-21";

const task = (title: string, order: string, fields: Partial<PlannerTask> = {}) =>
  ({
    _id: title,
    _creationTime: 0,
    title,
    notes: "",
    when: { kind: "inbox" },
    parent: { kind: "loose" },
    labelIds: [],
    status: { kind: "open" },
    order,
    labels: [],
    checklist: [],
    workBlocks: [],
    focus: { ms: 0, sessions: [] },
    ...fields,
  }) as unknown as PlannerTask;

const titles = (tasks: readonly PlannerTask[]) => tasks.map((row) => row.title);

describe("showNewTask", () => {
  test("puts a placed Task between its neighbours in the Inbox", () => {
    const shown = rewriteView(showNewTask(task("New", "a1V"), TODAY), "planner/lists:inbox", {}, { tasks: [task("One", "a1"), task("Two", "a2")] });
    expect(titles((shown as { tasks: PlannerTask[] }).tasks)).toEqual(["One", "New", "Two"]);
  });

  test("puts a captured Task with no place yet at the end of the Inbox", () => {
    const shown = rewriteView(showNewTask(task("New", "~"), TODAY), "planner/lists:inbox", {}, { tasks: [task("One", "a1"), task("Two", "a2")] });
    expect(titles((shown as { tasks: PlannerTask[] }).tasks)).toEqual(["One", "Two", "New"]);
  });

  test("shows a Task under its heading in its Project", () => {
    const project = { kind: "project", projectId: "p", headingId: "h" } as unknown as PlannerTask["parent"];
    const view = {
      project: { _id: "p" },
      sections: [
        { heading: null, tasks: [task("Loose", "a0")] },
        { heading: { _id: "h", title: "Methods" }, tasks: [task("One", "a1"), task("Two", "a2")] },
      ],
    };
    const shown = rewriteView(showNewTask(task("New", "a1V", { parent: project, when: { kind: "anytime" } }), TODAY), "planner/lists:project", { projectId: "p" }, view) as typeof view;
    expect(shown.sections.map((section) => titles(section.tasks))).toEqual([["Loose"], ["One", "New", "Two"]]);
  });

  test("shows a Task in its Area", () => {
    const area = { kind: "area", areaId: "a" } as unknown as PlannerTask["parent"];
    const view = { area: { _id: "a" }, tasks: [task("One", "a1")], projects: [] };
    const shown = rewriteView(showNewTask(task("New", "a0", { parent: area, when: { kind: "anytime" } }), TODAY), "planner/lists:area", { areaId: "a" }, view) as typeof view;
    expect(titles(shown.tasks)).toEqual(["New", "One"]);
  });

  test("shows a Task on its day in Upcoming", () => {
    const when = { kind: "scheduled", date: "2026-11-24", evening: false } as const;
    const view = { ok: true, value: { days: [{ date: "2026-11-23", tasks: [], deadlines: [] }, { date: "2026-11-24", tasks: [task("One", "a1")], deadlines: [] }] } };
    const shown = rewriteView(showNewTask(task("New", "~", { when }), TODAY), "planner/lists:upcoming", { date: TODAY, days: 14 }, view) as typeof view;
    expect(shown.value.days.map((day) => titles(day.tasks))).toEqual([[], ["One", "New"]]);
  });
});

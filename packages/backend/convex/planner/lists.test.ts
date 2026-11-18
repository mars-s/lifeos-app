import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, unwrap } from "../backend.test-utils";
import type { IsoDate } from "../../shared/date";
import { seedPlanner } from "./seed.test-utils";

const today = "2026-11-18" as IsoDate;
const now = Date.parse("2026-11-18T04:00:00Z");
const DAY_MS = 86_400_000;

const seeded = async () => {
  const t = await newBackend();
  const ids = await t.run((ctx) => seedPlanner(ctx, today, now));
  return { t, ids };
};

const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title);

test("the sidebar counts the Inbox and Today, and lists each Area with its open Projects and their progress", async () => {
  const { t } = await seeded();
  const sidebar = unwrap(await t.query(api.planner.sidebar.get, { date: today }));
  expect(sidebar.counts).toEqual({ inbox: 4, today: 8 });
  expect(sidebar.areas.map((area) => [area.title, area.colour, titles(area.projects)])).toEqual([
    ["University", "violet", ["Honours thesis", "COMP3900 group project"]],
    ["Paperless", "orange", ["Launch Paperless 1.0"]],
    ["Korvant", "teal", ["Onboarding rework"]],
    ["Personal", "green", ["Japan trip"]],
    ["Chemwatch", "rose", []],
  ]);
  expect(titles(sidebar.projects)).toEqual(["Tax return 2026"]);
  const thesis = sidebar.areas[0]?.projects[0];
  expect(thesis?.progress).toEqual({ done: 13, total: 19 });
  expect(sidebar.areas[3]?.projects[0]?.someday).toBe(true);
});

test("the Inbox holds open, untrashed Tasks with no When, in Things order", async () => {
  const { t } = await seeded();
  const { tasks } = await t.query(api.planner.lists.inbox, {});
  expect(titles(tasks)).toEqual([
    "Get moleskine notebooks from Officeworks",
    "https://www.curseforge.com/minecraft/mc-mods/diorama",
    "Ask Priya about the reading group",
    "Idea: weekly review as a single page",
  ]);
});

test("Today rows carry the Area colour, Project, Labels and Checklist Items the screen draws", async () => {
  const { t } = await seeded();
  const view = unwrap(await t.query(api.planner.today.get, { date: today }));
  const outline = view.tasks.find((task) => task.title === "Draft the thesis outline");
  expect(outline?.area).toMatchObject({ title: "University", colour: "violet" });
  expect(outline?.project?.title).toBe("Honours thesis");
  expect(outline?.context).toBe("Honours thesis");
  expect(outline?.labels.map((label) => label.name)).toEqual(["Deep Work"]);
  expect(outline?.checklist.map((item) => [item.title, item.done])).toEqual([
    ["Collect section headings", true],
    ["Write one line per section", false],
    ["Send to Dr Lin", false],
  ]);
  expect(titles(view.evening)).toEqual(["Cook dinner for Sam", "Read two papers on retrieval"]);
});

test("Anytime groups active Tasks by Area and Project, includes Today's Tasks and leaves out Someday Projects", async () => {
  const { t } = await seeded();
  const { groups } = unwrap(await t.query(api.planner.lists.anytime, { date: today }));
  const names = groups.map(({ container }) =>
    container.kind === "loose" ? "loose" : container.kind === "area" ? container.area.title : container.project.title,
  );
  expect(names).toEqual([
    "loose",
    "Tax return 2026",
    "Honours thesis",
    "COMP3900 group project",
    "Paperless",
    "Launch Paperless 1.0",
    "Korvant",
    "Onboarding rework",
    "Personal",
    "Chemwatch",
  ]);
  const paperless = groups.find(({ container }) => container.kind === "area" && container.area.title === "Paperless");
  expect(titles(paperless?.tasks ?? [])).toEqual([
    "Reply to Harry about the October invoice",
    "Save Paperless Labs logo in the repository",
    "Split README MCP comparison into Hobbyist and Enterprise editions",
    "Read and write perms per vault for agents",
    "Rotate the staging API keys",
    "Write the changelog for 0.9",
  ]);
  const everything = groups.flatMap((group) => titles(group.tasks));
  expect(everything).not.toContain("Book the rail pass");
  expect(everything).not.toContain("Renew the passport");
  expect(everything).not.toContain("Bill Harry for Paperless");
  expect(everything).not.toContain("Old idea that was binned");
});

test("Someday holds parked Tasks by container, and lists Projects parked whole without repeating their Tasks", async () => {
  const { t } = await seeded();
  const view = await t.query(api.planner.lists.someday, {});
  expect(view.groups.flatMap((group) => titles(group.tasks)).toSorted()).toEqual(
    [
      "Learn to make ramen from scratch",
      "Try the Blue Mountains overnight hike",
      "Write up the scanner architecture as a blog post",
      "Explore local-first sync for Paperless",
      "Read Gödel, Escher, Bach",
    ].toSorted(),
  );
  expect(view.projects.map((project) => [project.title, project.area?.title])).toEqual([["Japan trip", "Personal"]]);
});

test("Upcoming returns each day after today that has Tasks or Deadlines, inside the window", async () => {
  const { t } = await seeded();
  const view = unwrap(await t.query(api.planner.lists.upcoming, { date: today, days: 14 }));
  expect(view.until).toBe("2026-12-02");
  expect(view.days.map((day) => [day.date, titles(day.tasks), titles(day.deadlines)])).toEqual([
    ["2026-11-19", ["Bill Harry for Paperless", "Weekly working bee prep"], ["Bill Harry for Paperless"]],
    ["2026-11-20", ["Return the hire car", "Tutorial marking, week 11"], []],
    ["2026-11-21", [], ["Draft the thesis outline"]],
    ["2026-11-22", ["Sprint demo rehearsal"], []],
    ["2026-11-24", ["Send Gary the weekly sync notes"], []],
    ["2026-11-27", ["Methods chapter: first full draft"], []],
    ["2026-11-30", [], ["Final report submission"]],
    ["2026-12-01", ["Renew the domain names"], []],
    ["2026-12-02", [], ["Methods chapter: first full draft"]],
  ]);
  expect(await t.query(api.planner.lists.upcoming, { date: "tomorrow", days: 14 })).toEqual({
    ok: false,
    error: { kind: "invalid_date", input: "tomorrow" },
  });
});

test("the Logbook pages through closed Tasks newest first and narrows to a brushed range", async () => {
  const { t } = await seeded();
  const first = await t.query(api.planner.lists.logbook, { paginationOpts: { numItems: 30, cursor: null } });
  expect(first.page).toHaveLength(30);
  expect(first.isDone).toBe(false);
  const closedAt = first.page.map((task) => (task.status.kind === "open" ? 0 : task.status.at));
  expect(closedAt).toEqual(closedAt.toSorted((a, b) => b - a));
  expect(first.page.every((task) => task.status.kind !== "open")).toBe(true);
  const second = await t.query(api.planner.lists.logbook, {
    paginationOpts: { numItems: 200, cursor: first.continueCursor },
  });
  expect(first.page.length + second.page.length).toBe(82);
  expect(second.isDone).toBe(true);

  const from = now - 3 * DAY_MS;
  const to = now - DAY_MS;
  const brushed = await t.query(api.planner.lists.logbook, { paginationOpts: { numItems: 200, cursor: null }, from, to });
  expect(brushed.page.length).toBeGreaterThan(0);
  expect(brushed.page.every((task) => task.status.kind !== "open" && task.status.at >= from && task.status.at <= to)).toBe(true);
});

test("the Logbook timeline gives one completion time per closed Task since the start", async () => {
  const { t } = await seeded();
  const all = await t.query(api.planner.lists.logbookTimeline, { from: 0 });
  expect(all.closedAt).toHaveLength(82);
  const recent = await t.query(api.planner.lists.logbookTimeline, { from: now - 7 * DAY_MS });
  expect(recent.closedAt.length).toBeLessThan(82);
  expect(recent.closedAt.every((at) => at >= now - 7 * DAY_MS)).toBe(true);
});

test("an Area page shows its own open Tasks and its Projects with progress", async () => {
  const { t, ids } = await seeded();
  const view = await t.query(api.planner.lists.area, { areaId: ids.areas.university });
  expect(view?.area).toMatchObject({ title: "University", colour: "violet" });
  expect(titles(view?.tasks ?? [])).toEqual(["Tutorial marking, week 11"]);
  expect(view?.projects.map((project) => [project.title, project.progress])).toEqual([
    ["Honours thesis", { done: 13, total: 19 }],
    ["COMP3900 group project", { done: 3, total: 5 }],
  ]);
});

test("a Project page sections open Tasks under their Headings and counts progress over every Task", async () => {
  const { t, ids } = await seeded();
  const view = await t.query(api.planner.lists.project, { projectId: ids.projects.launch });
  expect(view?.project.title).toBe("Launch Paperless 1.0");
  expect(view?.area?.title).toBe("Paperless");
  expect(view?.sections.map((section) => [section.heading?.title ?? null, titles(section.tasks)])).toEqual([
    [null, ["Pricing page"]],
    ["Build", ["Wire up the vault picker", "Import from a folder of PDFs", "Offline banner"]],
    ["Marketing", ["Landing page copy", "Record the two minute demo"]],
  ]);
  expect(view?.progress.total).toBe(view ? view.progress.done + 6 : 0);
});

test("a trashed Area or Project has no page", async () => {
  const { t, ids } = await seeded();
  await t.run(async (ctx) => {
    await ctx.db.patch("areas", ids.areas.chemwatch, { trashedAt: now });
    await ctx.db.patch("projects", ids.projects.tax, { trashedAt: now });
  });
  expect(await t.query(api.planner.lists.area, { areaId: ids.areas.chemwatch })).toBeNull();
  expect(await t.query(api.planner.lists.project, { projectId: ids.projects.tax })).toBeNull();
});

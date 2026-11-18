import { generateNKeysBetween } from "fractional-indexing";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { addDays, type IsoDate } from "../../shared/date";
import type { Colour, Parent, Status, When } from "./tables";

const DAY_MS = 86_400_000;

type SeedTask = {
  title: string;
  notes?: string;
  when?: When;
  deadline?: string;
  estimate?: number;
  parent?: Parent;
  labels?: Id<"labels">[];
  status?: Status;
  checklist?: [title: string, done: boolean][];
  focus?: [minutesAgo: number, minutes: number][];
  thingsList?: "inbox" | "today" | "anytime" | "upcoming" | "someday";
  trashedAt?: number;
};

const LOGBOOK_TITLES = [
  "Reply to Harry about the October invoice",
  "Submit the ethics form",
  "Review pull request for the vault picker",
  "Book the dentist",
  "Read chapter 4 of the methods text",
  "Renew the car registration",
  "Send the weekly update to Gary",
  "Fix the flaky upload test",
  "Order printer paper",
  "Draft the tutorial slides",
  "Pay the power bill",
  "Tidy the Korvant backlog",
  "Call Mum",
  "Mark the week 9 quizzes",
  "Refactor the scanner retry loop",
];

const keys = (count: number) => generateNKeysBetween(null, null, count);

const inArea = (areaId: Id<"areas">) => ({ kind: "area", areaId }) satisfies Parent;

const inProject = (projectId: Id<"projects">, headingId?: Id<"headings">) =>
  ({ kind: "project", projectId, ...(headingId ? { headingId } : {}) }) satisfies Parent;

export const seedPlanner = async (ctx: MutationCtx, today: IsoDate, now: number) => {
  const day = (offset: number) => addDays(today, offset);
  const on = (offset: number, evening = false) => ({ kind: "scheduled", date: day(offset), evening }) satisfies When;
  const anytime = { kind: "anytime" } satisfies When;
  const someday = { kind: "someday" } satisfies When;

  const areaSpecs = [
    ["University", "violet"],
    ["Paperless", "orange"],
    ["Korvant", "teal"],
    ["Personal", "green"],
    ["Chemwatch", "rose"],
  ] as const satisfies readonly (readonly [string, Colour])[];
  const areaKeys = keys(areaSpecs.length);
  const [university, paperless, korvant, personal, chemwatch] = await Promise.all(
    areaSpecs.map(([title, colour], index) =>
      ctx.db.insert("areas", { title, colour, order: areaKeys[index] ?? "a0", things: { id: `seed-area-${index}` } }),
    ),
  );
  if (!university || !paperless || !korvant || !personal || !chemwatch) throw new Error("seed areas");

  const labelSpecs = [
    ["Deep Work", "violet"],
    ["Admin", "slate"],
    ["Errand", "olive"],
  ] as const satisfies readonly (readonly [string, Colour])[];
  const labelKeys = keys(labelSpecs.length);
  const [deepWork, admin, errand] = await Promise.all(
    labelSpecs.map(([name, colour], index) => ctx.db.insert("labels", { name, colour, order: labelKeys[index] ?? "a0" })),
  );
  if (!deepWork || !admin || !errand) throw new Error("seed labels");

  const projectSpecs = [
    { title: "Honours thesis", areaId: university, when: anytime, deadline: day(40), notes: "Supervisor: Dr Lin. Draft due before the summer break." },
    { title: "COMP3900 group project", areaId: university, when: anytime, deadline: day(12), notes: "" },
    { title: "Launch Paperless 1.0", areaId: paperless, when: anytime, notes: "Ship the hobbyist edition first." },
    { title: "Onboarding rework", areaId: korvant, when: anytime, notes: "" },
    { title: "Japan trip", areaId: personal, when: someday, notes: "Cherry blossom season, two weeks." },
    { title: "Tax return 2026", areaId: undefined, when: anytime, deadline: day(20), notes: "" },
  ];
  const projectKeys = keys(projectSpecs.length);
  const projectIds = await Promise.all(
    projectSpecs.map(({ areaId, deadline, ...spec }, index) =>
      ctx.db.insert("projects", {
        ...spec,
        ...(areaId ? { areaId } : {}),
        ...(deadline ? { deadline } : {}),
        labelIds: [],
        status: { kind: "open" },
        order: projectKeys[index] ?? "a0",
        things: { id: `seed-project-${index}` },
      }),
    ),
  );
  const [thesis, comp3900, launch, onboarding, japan, tax] = projectIds;
  if (!thesis || !comp3900 || !launch || !onboarding || !japan || !tax) throw new Error("seed projects");

  const headingKeys = keys(5);
  const [literature, methods, writing, build, marketing] = await Promise.all(
    (
      [
        [thesis, "Literature review"],
        [thesis, "Methods"],
        [thesis, "Writing"],
        [launch, "Build"],
        [launch, "Marketing"],
      ] as const
    ).map(([projectId, title], index) => ctx.db.insert("headings", { projectId, title, order: headingKeys[index] ?? "a0" })),
  );
  if (!literature || !methods || !writing || !build || !marketing) throw new Error("seed headings");

  const done = (daysAgo: number, hour = 15) =>
    ({ kind: "completed", at: now - daysAgo * DAY_MS - (hour % 9) * 3_600_000 }) satisfies Status;

  const open: SeedTask[] = [
    { title: "Get moleskine notebooks from Officeworks", notes: "A5, dotted. Two of them.", thingsList: "inbox" },
    { title: "https://www.curseforge.com/minecraft/mc-mods/diorama", thingsList: "inbox" },
    { title: "Ask Priya about the reading group", thingsList: "inbox" },
    { title: "Idea: weekly review as a single page", notes: "Look at how Sunsama does the weekly summary.", thingsList: "inbox" },

    {
      title: "Draft the thesis outline",
      notes: "Start from the proposal. Template: https://www.overleaf.com/latex/templates",
      when: on(0),
      deadline: day(3),
      estimate: 90,
      parent: inProject(thesis, writing),
      labels: [deepWork],
      checklist: [
        ["Collect section headings", true],
        ["Write one line per section", false],
        ["Send to Dr Lin", false],
      ],
      focus: [
        [190, 25],
        [150, 18],
      ],
      thingsList: "today",
    },
    { title: "Reply to Harry about the October invoice", when: on(0), estimate: 15, parent: inArea(paperless), labels: [admin], focus: [[95, 21]], thingsList: "today" },
    { title: "Review the onboarding copy", when: on(-2), deadline: day(-1), estimate: 45, parent: inProject(onboarding), focus: [[60, 30]], thingsList: "today" },
    { title: "Book a physio appointment", when: on(0), estimate: 10, parent: inArea(personal), labels: [errand], thingsList: "today" },
    { title: "Pick up the parcel from the post office", when: on(0), thingsList: "today" },
    { title: "Create Google Doc developer documentation for scanner.ai", when: anytime, deadline: day(0), estimate: 60, parent: inArea(chemwatch), thingsList: "today" },
    { title: "Cook dinner for Sam", when: on(0, true), parent: inArea(personal), thingsList: "today" },
    { title: "Read two papers on retrieval", when: on(0, true), estimate: 60, parent: inProject(thesis, literature), labels: [deepWork], thingsList: "today" },

    { title: "Bill Harry for Paperless", when: on(1), deadline: day(1), estimate: 20, parent: inArea(paperless), labels: [admin], thingsList: "upcoming" },
    { title: "Weekly working bee prep", when: on(1), estimate: 30, parent: inArea(paperless), thingsList: "upcoming" },
    { title: "Return the hire car", when: on(2), parent: inArea(personal), labels: [errand], thingsList: "upcoming" },
    { title: "Tutorial marking, week 11", when: on(2), estimate: 120, parent: inArea(university), thingsList: "upcoming" },
    { title: "Sprint demo rehearsal", when: on(4), estimate: 45, parent: inProject(comp3900), thingsList: "upcoming" },
    { title: "Send Gary the weekly sync notes", when: on(6), estimate: 15, parent: inArea(korvant), thingsList: "upcoming" },
    { title: "Methods chapter: first full draft", when: on(9), deadline: day(14), estimate: 240, parent: inProject(thesis, methods), labels: [deepWork], thingsList: "upcoming" },
    { title: "Renew the domain names", when: on(13), deadline: day(16), estimate: 10, parent: inArea(paperless), labels: [admin], thingsList: "upcoming" },
    { title: "Final report submission", when: anytime, deadline: day(12), estimate: 180, parent: inProject(comp3900), thingsList: "anytime" },
    { title: "Car service", when: on(19), parent: inArea(personal), labels: [errand], thingsList: "upcoming" },
    { title: "Christmas flights home", when: on(24), deadline: day(27), parent: inArea(personal), thingsList: "upcoming" },

    { title: "Save Paperless Labs logo in the repository", notes: "SVG and PNG, in /brand.", when: anytime, estimate: 10, parent: inArea(paperless), thingsList: "anytime" },
    { title: "Split README MCP comparison into Hobbyist and Enterprise editions", notes: "Two tables.", when: anytime, estimate: 45, parent: inArea(paperless), thingsList: "anytime" },
    { title: "Read and write perms per vault for agents", when: anytime, estimate: 120, parent: inArea(paperless), labels: [deepWork], thingsList: "anytime" },
    { title: "Rotate the staging API keys", when: anytime, estimate: 15, parent: inArea(paperless), labels: [admin], thingsList: "anytime" },
    { title: "Write the changelog for 0.9", when: anytime, estimate: 30, parent: inArea(paperless), thingsList: "anytime" },
    { title: "Wire up the vault picker", when: anytime, estimate: 90, parent: inProject(launch, build), labels: [deepWork], checklist: [["List vaults", true], ["Remember the last one", true], ["Empty state", false]], thingsList: "anytime" },
    { title: "Import from a folder of PDFs", when: anytime, estimate: 120, parent: inProject(launch, build), thingsList: "anytime" },
    { title: "Offline banner", when: anytime, estimate: 30, parent: inProject(launch, build), thingsList: "anytime" },
    { title: "Landing page copy", when: anytime, estimate: 60, parent: inProject(launch, marketing), thingsList: "anytime" },
    { title: "Record the two minute demo", when: anytime, estimate: 45, parent: inProject(launch, marketing), thingsList: "anytime" },
    { title: "Pricing page", when: anytime, parent: inProject(launch), thingsList: "anytime" },
    { title: "Summarise Lewis et al. 2020", when: anytime, estimate: 40, parent: inProject(thesis, literature), thingsList: "anytime" },
    { title: "Build the evaluation harness", notes: "Reuse the scripts from the proposal.", when: anytime, estimate: 180, parent: inProject(thesis, methods), labels: [deepWork], thingsList: "anytime" },
    { title: "Ask the library about thesis binding", when: anytime, parent: inProject(thesis), labels: [admin], thingsList: "anytime" },
    { title: "Map the first-run flow", when: anytime, estimate: 60, parent: inProject(onboarding), thingsList: "anytime" },
    { title: "Interview two new users", when: anytime, estimate: 90, parent: inProject(onboarding), thingsList: "anytime" },
    { title: "Clean up the Korvant staging data", when: anytime, estimate: 30, parent: inArea(korvant), thingsList: "anytime" },
    { title: "Gather payment summaries", when: anytime, estimate: 20, parent: inProject(tax), labels: [admin], thingsList: "anytime" },
    { title: "Work from home deductions", when: anytime, estimate: 40, parent: inProject(tax), thingsList: "anytime" },
    { title: "Fix the bike's rear brake", when: anytime, parent: inArea(personal), labels: [errand], thingsList: "anytime" },
    { title: "Buy a birthday present for Dad", when: anytime, deadline: day(30), parent: inArea(personal), thingsList: "anytime" },
    { title: "Back up the photo library", when: anytime, thingsList: "anytime" },

    { title: "Learn to make ramen from scratch", when: someday, parent: inArea(personal), thingsList: "someday" },
    { title: "Try the Blue Mountains overnight hike", when: someday, parent: inArea(personal), thingsList: "someday" },
    { title: "Write up the scanner architecture as a blog post", when: someday, estimate: 180, parent: inArea(chemwatch), thingsList: "someday" },
    { title: "Explore local-first sync for Paperless", notes: "https://www.inkandswitch.com/local-first/", when: someday, parent: inArea(paperless), thingsList: "someday" },
    { title: "Read Gödel, Escher, Bach", when: someday, thingsList: "someday" },
    { title: "Book the rail pass", when: someday, parent: inProject(japan), thingsList: "someday" },
    { title: "Pick three cities", when: someday, parent: inProject(japan), thingsList: "someday" },
    { title: "Renew the passport", when: anytime, parent: inProject(japan), thingsList: "anytime" },

    { title: "Old idea that was binned", when: anytime, trashedAt: now - DAY_MS, thingsList: "anytime" },
  ];

  const logParents = [inArea(paperless), inArea(university), inArea(korvant), inArea(personal), inProject(thesis, literature), inProject(launch, build), { kind: "loose" } satisfies Parent];
  const logged: SeedTask[] = Array.from({ length: 74 }, (_, index) => {
    const daysAgo = Math.floor((index * index) / 100) + (index % 3 === 0 ? 0 : 1);
    return {
      title: LOGBOOK_TITLES[index % LOGBOOK_TITLES.length] ?? "Logged Task",
      when: anytime,
      status:
        index % 17 === 5 ? ({ kind: "canceled", at: now - daysAgo * DAY_MS - 5_400_000 } satisfies Status) : done(daysAgo, index),
      parent: logParents[index % logParents.length] ?? { kind: "loose" },
      ...(index % 4 === 0 ? { estimate: [15, 30, 45, 60][index % 4 === 0 ? (index / 4) % 4 : 0] ?? 30 } : {}),
    };
  });
  const projectDone: SeedTask[] = [
    { title: "Pick a thesis topic", parent: inProject(thesis), status: done(50) },
    { title: "Write the proposal", parent: inProject(thesis, writing), status: done(41) },
    { title: "Search the ACL anthology", parent: inProject(thesis, literature), status: done(20) },
    { title: "Set up the repository", parent: inProject(comp3900), status: done(30) },
    { title: "Sprint 1 retro", parent: inProject(comp3900), status: done(16) },
    { title: "Sprint 2 retro", parent: inProject(comp3900), status: done(2) },
    { title: "Pick the vault file format", parent: inProject(launch, build), status: done(25) },
    { title: "Name the product", parent: inProject(launch, marketing), status: done(33) },
  ];

  const all = [...open, ...logged, ...projectDone];
  const orderKeys = keys(all.length);
  const listIndex = new Map<string, number>();
  for (const [index, task] of all.entries()) {
    const position = listIndex.get(task.thingsList ?? "") ?? 0;
    if (task.thingsList) listIndex.set(task.thingsList, position + 1);
    const taskId = await ctx.db.insert("tasks", {
      title: task.title,
      notes: task.notes ?? "",
      when: task.when ?? { kind: "inbox" },
      ...(task.deadline ? { deadline: task.deadline } : {}),
      ...(task.estimate ? { estimateMinutes: task.estimate } : {}),
      parent: task.parent ?? { kind: "loose" },
      labelIds: task.labels ?? [],
      status: task.status ?? { kind: "open" },
      ...(task.trashedAt ? { trashedAt: task.trashedAt } : {}),
      order: orderKeys[index] ?? "a0",
      ...(task.thingsList
        ? { things: { id: `seed-task-${index}`, todayIndex: task.thingsList === "today" ? position : 0 } }
        : {}),
    });
    const itemKeys = keys(task.checklist?.length ?? 0);
    for (const [itemIndex, [title, ticked]] of (task.checklist ?? []).entries()) {
      await ctx.db.insert("checklistItems", { taskId, title, done: ticked, order: itemKeys[itemIndex] ?? "a0" });
    }
    for (const [minutesAgo, minutes] of task.focus ?? []) {
      const start = now - minutesAgo * 60_000;
      await ctx.db.insert("focusSessions", {
        taskId,
        kind: "focus",
        start,
        pausedMs: 0,
        state: { kind: "ended", at: start + minutes * 60_000 },
      });
    }
  }
  await ctx.db.insert("thingsSync", { syncedAt: now - 40_000, counts: { areas: 5, projects: 6, headings: 0, tasks: open.length, checklistItems: 0, labels: 0 } });
  return { areas: { university, paperless, korvant, personal, chemwatch }, projects: { thesis, comp3900, launch, onboarding, japan, tax } };
};

import { expect, test } from "vitest";
import { api } from "../_generated/api";
import { newBackend, refusal, registerWorker, unwrap, type Backend } from "../backend.test-utils";

const projection = (docId: string, title: string, extra: Record<string, unknown> = {}) => ({
  docId,
  title,
  excerpt: `${title} body`,
  words: 3,
  labels: [],
  entities: [],
  noteTitles: [],
  ...extra,
});

const nextMillisecond = async () => {
  const now = Date.now();
  while (Date.now() === now) await new Promise((resolve) => setTimeout(resolve, 1));
};

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "relay", ["notes"]);
  const project = async (docId: string, title: string, extra: Record<string, unknown> = {}) => {
    await nextMillisecond();
    return t.mutation(api.notes.relay.project, { token, ...projection(docId, title, extra) });
  };
  return { t, token, project };
};

const areaNamed = async (t: Backend, title: string) => unwrap(await t.mutation(api.planner.areas.create, { title })).areaId;

test("the relay's projection lists, updates in place and searches", async () => {
  const { t, project } = await setup();
  await project("doc-a", "Retrieval reading");
  await project("doc-b", "Japan trip");
  await project("doc-a", "Retrieval reading notes");
  const rows = await t.query(api.notes.notes.list, {});
  expect(rows.map((row) => row.title)).toEqual(["Retrieval reading notes", "Japan trip"]);
  const hits = await t.query(api.notes.notes.search, { query: "japan" });
  expect(hits.map((row) => row.docId)).toEqual(["doc-b"]);
  expect((await t.query(api.notes.notes.get, { docId: "doc-a" }))?.title).toBe("Retrieval reading notes");
});

test("only a Worker with the notes capability can project", async () => {
  const { t } = await setup();
  const other = await registerWorker(t, "things", ["things"]);
  expect(String(await refusal(t.mutation(api.notes.relay.project, { token: other, ...projection("x", "X") })))).toContain("notes work");
  expect(await refusal(t.mutation(api.notes.relay.project, { token: "nope", ...projection("x", "X") }))).toBeTruthy();
  expect(await t.query(api.notes.notes.list, {})).toEqual([]);
});

test("a note's folder, Labels and links come from its text", async () => {
  const { t, project } = await setup();
  const areaId = await areaNamed(t, "University");
  const projectId = unwrap(await t.mutation(api.planner.projects.create, { title: "Thesis", areaId })).projectId;
  const taskId = unwrap(await t.mutation(api.planner.tasks.create, { title: "Read papers" })).taskId;
  unwrap(await t.mutation(api.planner.labels.create, { name: "Reading", colour: "teal" }));
  await project("target", "Dense and sparse");
  await project("source", "Outline", {
    folder: { table: "projects", id: projectId },
    labels: ["reading", "unknown"],
    entities: [{ table: "tasks", id: taskId }, { table: "tasks", id: "not-an-id" }],
    noteTitles: ["dense AND sparse", "Not written yet"],
  });
  const source = await t.query(api.notes.notes.get, { docId: "source" });
  expect(source?.projectId).toBe(projectId);
  expect(source?.areaId).toBe(areaId);
  expect(source?.labelIds).toHaveLength(1);
  const links = await t.query(api.notes.notes.links, { docId: "source" });
  expect(links.linksOut).toEqual([
    { kind: "entity", table: "tasks", id: taskId, title: "Read papers" },
    { kind: "note", note: expect.objectContaining({ docId: "target" }) },
  ]);
  expect((await t.query(api.notes.notes.links, { docId: "target" })).linkedFrom.map((n) => n.docId)).toEqual(["source"]);
  expect((await t.query(api.notes.notes.forEntity, { entity: { table: "tasks", id: taskId } })).map((n) => n.docId)).toEqual(["source"]);

  await project("source", "Outline", { entities: [] });
  expect((await t.query(api.notes.notes.links, { docId: "source" })).linksOut).toEqual([]);
});

test("a link from a note never blocks undoing the Task it points at", async () => {
  const { t, project } = await setup();
  const created = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book the ferry" }));
  await project("trip", "Trip", { entities: [{ table: "tasks", id: created.taskId }] });
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: created.activityId! }));
  await project("trip", "Trip", { entities: [{ table: "tasks", id: created.taskId }] });
  expect((await t.query(api.notes.notes.links, { docId: "trip" })).linksOut).toEqual([]);
});

test("trashing a note hides it, a later projection keeps it trashed, and undo brings it back", async () => {
  const { t, project } = await setup();
  const { noteId } = await project("doc", "Pricing");
  const trashed = unwrap(await t.mutation(api.notes.notes.trash, { noteId }));
  expect(await t.query(api.notes.notes.list, {})).toEqual([]);
  await project("doc", "Pricing again");
  expect(await t.query(api.notes.notes.list, {})).toEqual([]);
  unwrap(await t.mutation(api.platform.undo.undo, { activityId: trashed.activityId! }));
  expect((await t.query(api.notes.notes.list, {})).map((n) => n.title)).toEqual(["Pricing again"]);
});

test("changedSince returns every projection newer than a device's last sync", async () => {
  const { t, project } = await setup();
  await project("one", "One");
  await project("two", "Two");
  const two = (await t.query(api.notes.notes.get, { docId: "two" }))!;
  const one = (await t.query(api.notes.notes.get, { docId: "one" }))!;
  expect(await t.query(api.notes.notes.changedSince, { since: two.updatedAt })).toEqual([]);
  expect((await t.query(api.notes.notes.changedSince, { since: one.updatedAt - 1 })).map((n) => n.docId)).toEqual(["one", "two"]);
  await project("one", "One again");
  expect((await t.query(api.notes.notes.changedSince, { since: two.updatedAt - 1 })).map((n) => n.title)).toContain("One again");
});

test("chips read live titles and ticks, and [[ suggests open Tasks, Projects and Areas", async () => {
  const { t } = await setup();
  const areaId = await areaNamed(t, "Personal");
  const { taskId } = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book the ferry" }));
  unwrap(await t.mutation(api.planner.tasks.complete, { taskId }));
  const chips = await t.query(api.notes.notes.entities, { ids: [taskId, areaId, "nonsense"] });
  expect(chips).toEqual([
    expect.objectContaining({ id: taskId, table: "tasks", title: "Book the ferry", done: true }),
    expect.objectContaining({ id: areaId, table: "areas", title: "Personal" }),
  ]);
  unwrap(await t.mutation(api.planner.tasks.create, { title: "Pack for the ferry" }));
  const offered = await t.query(api.notes.notes.suggest, { query: "ferry" });
  expect(offered.tasks.map((task) => task.title)).toEqual(["Pack for the ferry"]);
  expect((await t.query(api.notes.notes.suggest, { query: "pers" })).areas.map((a) => a.title)).toEqual(["Personal"]);
});

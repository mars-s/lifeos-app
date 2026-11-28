import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { newBackend, registerWorker, unwrap, type Backend } from "../backend.test-utils";

const NOW = Date.UTC(2026, 10, 29, 9, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = async () => {
  const t = await newBackend();
  const token = await registerWorker(t, "relay", ["notes"]);
  const project = (docId: string, title: string, extra: Record<string, unknown> = {}) =>
    t.mutation(api.notes.relay.project, {
      token,
      docId,
      title,
      excerpt: `${title} body`,
      words: 3,
      labels: [],
      entities: [],
      noteTitles: [],
      ...extra,
    });
  return { t, token, project };
};

const row = (docId: string, title: string, id: string, extra: Record<string, unknown> = {}) => ({
  id,
  docId,
  title,
  excerpt: `${title} body`,
  words: 3,
  labelIds: [],
  updatedAt: expect.any(Number),
  ...extra,
});

const deleteNote = (t: Backend, noteId: string) =>
  t.run(async (ctx) => {
    const id = ctx.db.normalizeId("notes", noteId);
    if (id) await ctx.db.delete("notes", id);
  });

test("project returns the note id, and the worker refusals stay thrown", async () => {
  const { t, project } = await setup();
  const first = await project("doc-a", "Alpha");
  expect(first).toStrictEqual({ noteId: expect.any(String) });
  const again = await project("doc-a", "Alpha again");
  expect(again).toStrictEqual({ noteId: first.noteId });
  const stranger = await registerWorker(t, "things", ["things"]);
  await expect(
    t.mutation(api.notes.relay.project, { token: stranger, docId: "x", title: "X", excerpt: "", words: 0, labels: [], entities: [], noteTitles: [] }),
  ).rejects.toThrow(/notes work/);
});

test("trash and restore answer with the wire result, and a missing note is a refusal", async () => {
  const { t, project } = await setup();
  const { noteId } = await project("doc", "Pricing");
  expect(await t.mutation(api.notes.notes.restore, { noteId })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
  expect(await t.mutation(api.notes.notes.trash, { noteId })).toStrictEqual({
    ok: true,
    value: { changed: true, activityId: expect.any(String) },
  });
  expect(await t.mutation(api.notes.notes.trash, { noteId })).toStrictEqual({ ok: true, value: { changed: false, activityId: null } });
  expect(await t.mutation(api.notes.notes.restore, { noteId })).toStrictEqual({
    ok: true,
    value: { changed: true, activityId: expect.any(String) },
  });
  await deleteNote(t, noteId);
  const missing = { ok: false, error: { kind: "not_found" } };
  expect(await t.mutation(api.notes.notes.trash, { noteId })).toStrictEqual(missing);
  expect(await t.mutation(api.notes.notes.restore, { noteId })).toStrictEqual(missing);
});

test("the note queries return their rows as plain JSON", async () => {
  const { t, project } = await setup();
  const { noteId: a } = await project("doc-a", "Alpha");
  const { noteId: b } = await project("doc-b", "Beta ferry");
  expect(await t.query(api.notes.notes.list, {})).toStrictEqual([row("doc-b", "Beta ferry", b), row("doc-a", "Alpha", a)]);
  expect(await t.query(api.notes.notes.get, { docId: "doc-a" })).toStrictEqual(row("doc-a", "Alpha", a));
  expect(await t.query(api.notes.notes.get, { docId: "nope" })).toBeNull();
  expect(await t.query(api.notes.notes.search, { query: "ferry" })).toStrictEqual([row("doc-b", "Beta ferry", b)]);
  expect(await t.query(api.notes.notes.search, { query: "   " })).toStrictEqual([]);
  expect(await t.query(api.notes.notes.changedSince, { since: NOW + 1 })).toStrictEqual([]);
  expect(await t.query(api.notes.notes.changedSince, { since: NOW - 1 })).toStrictEqual([row("doc-a", "Alpha", a), row("doc-b", "Beta ferry", b)]);
});

test("links, chips and suggestions return their whole JSON", async () => {
  const { t, project } = await setup();
  const areaId = unwrap(await t.mutation(api.planner.areas.create, { title: "Personal" })).areaId;
  const taskId = unwrap(await t.mutation(api.planner.tasks.create, { title: "Book the ferry" })).taskId;
  const { noteId: target } = await project("target", "Dense notes");
  const { noteId: source } = await project("source", "Outline", {
    entities: [{ table: "tasks", id: taskId }],
    noteTitles: ["dense notes"],
  });
  expect(await t.query(api.notes.notes.links, { docId: "source" })).toStrictEqual({
    linkedFrom: [],
    linksOut: [
      { kind: "entity", table: "tasks", id: taskId, title: "Book the ferry" },
      { kind: "note", note: row("target", "Dense notes", target) },
    ],
  });
  expect(await t.query(api.notes.notes.links, { docId: "target" })).toStrictEqual({
    linkedFrom: [row("source", "Outline", source)],
    linksOut: [],
  });
  expect(await t.query(api.notes.notes.links, { docId: "nope" })).toStrictEqual({ linkedFrom: [], linksOut: [] });
  expect(await t.query(api.notes.notes.forEntity, { entity: { table: "tasks", id: taskId } })).toStrictEqual([row("source", "Outline", source)]);
  expect(await t.query(api.notes.notes.entities, { ids: [taskId, areaId, "nonsense"] })).toStrictEqual([
    { id: taskId, table: "tasks", title: "Book the ferry", done: false, trashed: false },
    { id: areaId, table: "areas", title: "Personal", colour: expect.anything(), trashed: false },
  ]);
  expect(await t.query(api.notes.notes.suggest, { query: "ferry" })).toStrictEqual({
    tasks: [{ id: taskId, title: "Book the ferry" }],
    projects: [],
    areas: [],
  });
  expect(await t.query(api.notes.notes.suggest, { query: "pers" })).toStrictEqual({
    tasks: [],
    projects: [],
    areas: [{ id: areaId, title: "Personal" }],
  });
});

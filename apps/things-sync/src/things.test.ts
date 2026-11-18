import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { findThingsDatabase, readThingsRows } from "./things.ts";

const run = promisify(execFile);

const SCHEMA = `
CREATE TABLE TMArea (uuid TEXT, title TEXT, "index" INTEGER);
CREATE TABLE TMTag (uuid TEXT, title TEXT, "index" INTEGER);
CREATE TABLE TMTask (
  uuid TEXT, type INTEGER, title TEXT, notes TEXT, status INTEGER, trashed INTEGER, start INTEGER,
  startDate INTEGER, startBucket INTEGER, deadline INTEGER, stopDate REAL, userModificationDate REAL,
  "index" INTEGER, todayIndex INTEGER, area TEXT, project TEXT, heading TEXT, rt1_recurrenceRule BLOB
);
CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
CREATE TABLE TMChecklistItem (uuid TEXT, task TEXT, title TEXT, status INTEGER, "index" INTEGER);
PRAGMA journal_mode = WAL;
INSERT INTO TMArea VALUES ('a1', 'University', 0);
INSERT INTO TMTag VALUES ('g1', 'Errand', 0);
INSERT INTO TMTask VALUES ('t1', 0, 'Walk', NULL, 3, 0, 1, 132822784, 1, NULL, 1763400000.5, 1763400001, 4, -12, 'a1', NULL, NULL, NULL);
INSERT INTO TMTask VALUES ('t2', 0, 'Water plants', '', 0, 0, 1, NULL, 0, NULL, NULL, NULL, 5, 0, NULL, NULL, NULL, X'00');
INSERT INTO TMTaskTag VALUES ('t1', 'g1');
INSERT INTO TMChecklistItem VALUES ('c1', 't1', 'Shoes', 3, 0);
`;

const thingsFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "things-fixture-"));
  const database = join(root, "JLMPQHK86H.com.culturedcode.ThingsMac", "ThingsData-ABCDE", "Things Database.thingsdatabase");
  await mkdir(database, { recursive: true });
  const reading = run("/usr/bin/sqlite3", [join(database, "main.sqlite")]);
  reading.child.stdin?.end(SCHEMA);
  await reading;
  return { root, database };
};

const scratchDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("lifeos-things-"));

test("finds the Things database inside the Group Containers folder", async () => {
  const { root, database } = await thingsFixture();
  assert.equal((await findThingsDatabase(root))._unsafeUnwrap(), database);
  await rm(root, { recursive: true, force: true });
});

test("reads the rows from a copy, leaves the original alone and removes the copy", async () => {
  const { root, database } = await thingsFixture();
  const before = await readFile(join(database, "main.sqlite"));
  const scratchBefore = await scratchDirs();
  const rows = (await readThingsRows(database))._unsafeUnwrap();
  assert.deepEqual(rows.areas, [{ uuid: "a1", title: "University", index: 0 }]);
  assert.deepEqual(rows.items[0], {
    uuid: "t1",
    type: 0,
    title: "Walk",
    notes: "",
    status: 3,
    trashed: false,
    start: 1,
    startDate: 132822784,
    evening: true,
    deadline: null,
    stopDate: 1763400000.5,
    modifiedAt: 1763400001,
    index: 4,
    todayIndex: -12,
    area: "a1",
    project: null,
    heading: null,
    repeating: false,
    tags: ["g1"],
  });
  assert.equal(rows.items[1]?.repeating, true);
  assert.deepEqual(rows.checklistItems, [{ uuid: "c1", task: "t1", title: "Shoes", status: 3, index: 0 }]);
  assert.deepEqual(await readFile(join(database, "main.sqlite")), before);
  assert.deepEqual(await scratchDirs(), scratchBefore);
  await rm(root, { recursive: true, force: true });
});

test("an unreadable folder names the folder macOS refused", async () => {
  const { root } = await thingsFixture();
  await chmod(root, 0o000);
  const found = await findThingsDatabase(root);
  await chmod(root, 0o700);
  assert.deepEqual(found._unsafeUnwrapErr(), { kind: "permission_denied", path: root });
  await rm(root, { recursive: true, force: true });
});

test("a Mac without Things says where it looked", async () => {
  const root = await mkdtemp(join(tmpdir(), "no-things-"));
  assert.deepEqual((await findThingsDatabase(root))._unsafeUnwrapErr(), { kind: "things_not_found", path: root });
  await rm(root, { recursive: true, force: true });
});

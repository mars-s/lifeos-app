import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FunctionArgs } from "convex/server";
import { ResultAsync, errAsync, okAsync } from "neverthrow";
import type { api } from "@lifeos/backend/api";

export type ThingsRows = FunctionArgs<typeof api.planner.things.importRows>["rows"];

export type ReadError =
  | { readonly kind: "permission_denied"; readonly path: string }
  | { readonly kind: "things_not_found"; readonly path: string }
  | { readonly kind: "read_failed"; readonly detail: string };

export type TokenError = { readonly kind: "token_missing" };

const run = promisify(execFile);

export const GROUP_CONTAINERS = join(homedir(), "Library", "Group Containers");
const THINGS_CONTAINER = ".com.culturedcode.ThingsMac";
const DATABASE_FILES = ["main.sqlite", "main.sqlite-wal", "main.sqlite-shm"] as const;
const READER_SQL = new URL("../things.sql", import.meta.url);

const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const readError = (path: string) => (error: unknown) => {
  const code = codeOf(error);
  if (code === "EPERM" || code === "EACCES") return { kind: "permission_denied", path } satisfies ReadError;
  if (code === "ENOENT") return { kind: "things_not_found", path } satisfies ReadError;
  return { kind: "read_failed", detail: detailOf(error) } satisfies ReadError;
};

const entriesOf = (path: string) => ResultAsync.fromPromise(readdir(path), readError(path));

const pick = (path: string, entries: string[], matches: (entry: string) => boolean) => {
  const found = entries.find(matches);
  return found ? okAsync<string, ReadError>(join(path, found)) : errAsync<string, ReadError>({ kind: "things_not_found", path });
};

export const findThingsDatabase = (root = GROUP_CONTAINERS) =>
  entriesOf(root)
    .andThen((entries) => pick(root, entries, (entry) => entry.endsWith(THINGS_CONTAINER)))
    .andThen((container) =>
      entriesOf(container).andThen((entries) => pick(container, entries, (entry) => entry.startsWith("ThingsData-"))),
    )
    .map((data) => join(data, "Things Database.thingsdatabase"));

const copyIfPresent = (from: string, to: string) =>
  copyFile(from, to).then(
    () => true,
    (error: unknown) => {
      if (codeOf(error) === "ENOENT") return false;
      throw error;
    },
  );

const copyDatabase = (database: string, into: string) =>
  ResultAsync.fromPromise(
    Promise.all(DATABASE_FILES.map((name) => copyIfPresent(join(database, name), join(into, name)))),
    readError(database),
  ).andThen(([main]) =>
    main ? okAsync<string, ReadError>(join(into, "main.sqlite")) : errAsync<string, ReadError>({ kind: "things_not_found", path: database }),
  );

const query = (copy: string) =>
  ResultAsync.fromPromise(
    readFile(READER_SQL, "utf8").then((sql) => {
      const reading = run("/usr/bin/sqlite3", ["-readonly", copy], { maxBuffer: 256 * 1024 * 1024 });
      reading.child.stdin?.end(sql);
      return reading;
    }),
    (error) => ({ kind: "read_failed", detail: detailOf(error) }) satisfies ReadError,
  ).map(({ stdout }) => JSON.parse(stdout) as ThingsRows);

const readCopy = async (database: string, scratch: string) => {
  const rows = await copyDatabase(database, scratch).andThen(query);
  await rm(scratch, { recursive: true, force: true });
  return rows;
};

export const readThingsRows = (database: string) =>
  ResultAsync.fromPromise(mkdtemp(join(tmpdir(), "lifeos-things-")), readError(tmpdir())).andThen(
    (scratch) => new ResultAsync(readCopy(database, scratch)),
  );

export const readSyncToken = () => {
  const fromEnv = process.env.LIFEOS_THINGS_SYNC_TOKEN;
  if (fromEnv) return okAsync<string, TokenError>(fromEnv);
  return ResultAsync.fromPromise(
    run("security", ["find-generic-password", "-s", "lifeos-app-things-sync", "-a", process.env.USER ?? "", "-w"]),
    () => ({ kind: "token_missing" }) satisfies TokenError,
  ).map(({ stdout }) => stdout.trim());
};

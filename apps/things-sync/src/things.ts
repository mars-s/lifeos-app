import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Context, Effect, Layer, Predicate, Schema } from "effect";
import type { FunctionArgs } from "convex/server";
import type { api } from "@lifeos/backend/api";

export type ThingsRows = FunctionArgs<typeof api.planner.things.importRows>["rows"];

export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()("PermissionDenied", {
  kind: Schema.tag("permission_denied"),
  path: Schema.String,
}) {}

export class ThingsNotFound extends Schema.TaggedError<ThingsNotFound>()("ThingsNotFound", {
  kind: Schema.tag("things_not_found"),
  path: Schema.String,
}) {}

export class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", {
  kind: Schema.tag("read_failed"),
  detail: Schema.String,
}) {}

export class TokenMissing extends Schema.TaggedError<TokenMissing>()("TokenMissing", {
  kind: Schema.tag("token_missing"),
}) {}

export type ReadError = PermissionDenied | ThingsNotFound | ReadFailed;
export type TokenError = TokenMissing;

const NamedRow = Schema.Struct({ uuid: Schema.String, title: Schema.String, index: Schema.Number });

const ItemRow = Schema.Struct({
  uuid: Schema.String,
  type: Schema.Number,
  title: Schema.String,
  notes: Schema.String,
  status: Schema.Number,
  trashed: Schema.Boolean,
  start: Schema.Number,
  startDate: Schema.NullOr(Schema.Number),
  evening: Schema.Boolean,
  deadline: Schema.NullOr(Schema.Number),
  stopDate: Schema.NullOr(Schema.Number),
  modifiedAt: Schema.NullOr(Schema.Number),
  index: Schema.Number,
  todayIndex: Schema.Number,
  area: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  heading: Schema.NullOr(Schema.String),
  repeating: Schema.Boolean,
  tags: Schema.mutable(Schema.Array(Schema.String)),
});

const ChecklistRow = Schema.Struct({
  uuid: Schema.String,
  task: Schema.String,
  title: Schema.String,
  status: Schema.Number,
  index: Schema.Number,
});

const RowsJson = Schema.fromJsonString(
  Schema.Struct({
    areas: Schema.mutable(Schema.Array(NamedRow)),
    tags: Schema.mutable(Schema.Array(NamedRow)),
    items: Schema.mutable(Schema.Array(ItemRow)),
    checklistItems: Schema.mutable(Schema.Array(ChecklistRow)),
  }),
);

const decodeRows = Schema.decodeUnknownEffect(RowsJson);

const run = promisify(execFile);

export const GROUP_CONTAINERS = join(homedir(), "Library", "Group Containers");
const THINGS_CONTAINER = ".com.culturedcode.ThingsMac";
const DATABASE_FILES = ["main.sqlite", "main.sqlite-wal", "main.sqlite-shm"] as const;
const READER_SQL = new URL("../things.sql", import.meta.url);

const codeOf = (error: unknown) => (Predicate.isObject(error) && Predicate.isString(error.code) ? error.code : undefined);

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const readError = (path: string, error: unknown) => {
  const code = codeOf(error);
  if (code === "EPERM" || code === "EACCES") return new PermissionDenied({ path });
  if (code === "ENOENT") return new ThingsNotFound({ path });
  return new ReadFailed({ detail: detailOf(error) });
};

const entriesOf = (path: string) =>
  Effect.tryPromise({ try: () => readdir(path), catch: (error) => readError(path, error) });

const pick = Effect.fn("things.pick")(function* (path: string, entries: string[], matches: (entry: string) => boolean) {
  const found = entries.find(matches);
  if (!found) return yield* new ThingsNotFound({ path });
  return join(path, found);
});

export const findThingsDatabase = Effect.fn("things.findThingsDatabase")(function* (root = GROUP_CONTAINERS) {
  const container = yield* pick(root, yield* entriesOf(root), (entry) => entry.endsWith(THINGS_CONTAINER));
  const data = yield* pick(container, yield* entriesOf(container), (entry) => entry.startsWith("ThingsData-"));
  return join(data, "Things Database.thingsdatabase");
});

const copyIfPresent = (from: string, to: string) =>
  copyFile(from, to).then(
    () => true,
    (error: unknown) => {
      if (codeOf(error) === "ENOENT") return false;
      throw error;
    },
  );

const copyDatabase = Effect.fn("things.copyDatabase")(function* (database: string, into: string) {
  const [main] = yield* Effect.tryPromise({
    try: () => Promise.all(DATABASE_FILES.map((name) => copyIfPresent(join(database, name), join(into, name)))),
    catch: (error) => readError(database, error),
  });
  if (!main) return yield* new ThingsNotFound({ path: database });
  return join(into, "main.sqlite");
});

const query = Effect.fn("things.query")(function* (copy: string) {
  const { stdout } = yield* Effect.tryPromise({
    try: () =>
      readFile(READER_SQL, "utf8").then((sql) => {
        const reading = run("/usr/bin/sqlite3", ["-readonly", copy], { maxBuffer: 256 * 1024 * 1024 });
        reading.child.stdin?.end(sql);
        return reading;
      }),
    catch: (error) => new ReadFailed({ detail: detailOf(error) }),
  });
  const rows = yield* decodeRows(stdout).pipe(Effect.mapError((error) => new ReadFailed({ detail: error.message })));
  return rows satisfies ThingsRows;
});

export const readThingsRows = Effect.fn("things.readThingsRows")(function* (database: string) {
  const scratch = yield* Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "lifeos-things-")),
    catch: (error) => readError(tmpdir(), error),
  });
  return yield* copyDatabase(database, scratch).pipe(
    Effect.flatMap(query),
    Effect.ensuring(Effect.promise(() => rm(scratch, { recursive: true, force: true }))),
  );
});

export class ThingsSource extends Context.Service<
  ThingsSource,
  {
    rows(): Effect.Effect<ThingsRows, ReadError>;
  }
>()("lifeos/things-sync/ThingsSource") {
  static readonly layerAt = (root: string) =>
    Layer.succeed(
      ThingsSource,
      ThingsSource.of({
        rows: () => findThingsDatabase(root).pipe(Effect.flatMap(readThingsRows)),
      }),
    );

  static readonly layer = ThingsSource.layerAt(GROUP_CONTAINERS);

  static readonly layerTest = (rows: ThingsRows) =>
    Layer.succeed(ThingsSource, ThingsSource.of({ rows: () => Effect.succeed(rows) }));
}

export const readSyncToken = Effect.fn("things.readSyncToken")(function* () {
  const fromEnv = process.env.LIFEOS_THINGS_SYNC_TOKEN;
  if (fromEnv) return fromEnv;
  const { stdout } = yield* Effect.tryPromise({
    try: () => run("security", ["find-generic-password", "-s", "lifeos-app-things-sync", "-a", process.env.USER ?? "", "-w"]),
    catch: () => new TokenMissing(),
  });
  return stdout.trim();
});

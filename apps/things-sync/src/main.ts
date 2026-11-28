import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { Clock, Console, Duration, Effect, Schema } from "effect";
import { api } from "@lifeos/backend/api";
import { wireToEffect } from "@lifeos/backend/result";
import { dryRunCounts, importLines, readErrorLine, retiredLine } from "./report.ts";
import { ThingsSource, readSyncToken } from "./things.ts";

const WATCH_EVERY = Duration.minutes(5);

export class ConvexRejected extends Schema.TaggedError<ConvexRejected>()("ConvexRejected", {
  kind: Schema.tag("convex_rejected"),
  detail: Schema.String,
}) {}

class MissingConvexUrl extends Schema.TaggedError<MissingConvexUrl>()("MissingConvexUrl", {
  kind: Schema.tag("missing_convex_url"),
}) {}

const { values } = parseArgs({
  options: {
    watch: { type: "boolean", default: false },
    switch: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const failed = Effect.sync(() => {
  process.exitCode = 1;
});

const clock = Effect.map(Clock.currentTimeMillis, (now) =>
  new Date(now).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }),
);

const dryRun = Effect.gen(function* () {
  const things = yield* ThingsSource;
  const rows = yield* things.rows();
  yield* Console.log("Things, as read now (nothing was sent to LifeOS):");
  for (const [label, count] of dryRunCounts(rows, new Date(yield* Clock.currentTimeMillis).toLocaleDateString("en-CA"))) yield* Console.log(`  ${label}: ${count}`);
}).pipe(Effect.catch((error) => Effect.andThen(Console.error(readErrorLine(error)), failed)));

const convexClient = Effect.gen(function* () {
  const url = process.env.CONVEX_URL;
  if (!url) return yield* new MissingConvexUrl();
  return new ConvexHttpClient(url);
});

const rejected = (error: unknown) => new ConvexRejected({ detail: error instanceof Error ? error.message : String(error) });

const importOnce = Effect.fn("thingsSync.importOnce")(function* (client: ConvexHttpClient, token: string) {
  const things = yield* ThingsSource;
  const rows = yield* things.rows().pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Console.error(`${yield* clock} ${readErrorLine(error)}`);
        yield* failed;
        return null;
      }),
    ),
  );
  if (rows === null) return "failed" as const;
  const sent = yield* Effect.tryPromise({
    try: () => client.action(api.planner.things.importRows, { token, rows }),
    catch: rejected,
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Console.error(`${yield* clock} LifeOS refused the import: ${error.detail}`);
        yield* failed;
        return null;
      }),
    ),
  );
  if (sent === null) return "failed" as const;
  const imported = yield* wireToEffect(sent).pipe(Effect.catch((error) => Effect.succeed(error)));
  if ("retiredAt" in imported) {
    yield* Console.log(retiredLine(imported.retiredAt));
    process.exitCode = 0;
    return "retired" as const;
  }
  yield* Console.log(`${yield* clock} Imported from Things into LifeOS:`);
  for (const line of importLines(imported)) yield* Console.log(line);
  return "imported" as const;
});

const switchDay = Effect.fn("thingsSync.switchDay")(function* (client: ConvexHttpClient, token: string) {
  const outcome = yield* importOnce(client, token);
  if (outcome !== "imported") return;
  const retired = yield* Effect.tryPromise({
    try: () => client.mutation(api.planner.things.retire, { token }),
    catch: rejected,
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Console.error(`LifeOS could not retire Things: ${error.detail}`);
        yield* failed;
        return null;
      }),
    ),
  );
  if (retired === null) return;
  yield* wireToEffect(retired).pipe(
    Effect.matchEffect({
      onSuccess: ({ retiredAt }) =>
        Effect.gen(function* () {
          yield* Console.log(retiredLine(retiredAt));
          yield* Console.log("That was the final import. Every Task now lives in LifeOS, and nothing is read from Things again.");
        }),
      onFailure: () =>
        Effect.andThen(Console.error("LifeOS has no import from Things yet, so there is nothing to retire."), failed),
    }),
  );
});

const syncLoop = Effect.fn("thingsSync.syncLoop")(function* (client: ConvexHttpClient, token: string) {
  for (;;) {
    const outcome = yield* importOnce(client, token);
    if (!values.watch || outcome === "retired") return;
    yield* Effect.sleep(WATCH_EVERY);
  }
});

const program = Effect.gen(function* () {
  if (values["dry-run"]) return yield* dryRun;
  const client = yield* convexClient;
  const token = yield* readSyncToken();
  if (values.switch) return yield* switchDay(client, token);
  return yield* syncLoop(client, token);
}).pipe(
  Effect.catch((error) =>
    error.kind === "missing_convex_url"
      ? Effect.andThen(Console.error("Set CONVEX_URL in apps/things-sync/.env.local (see .env.example)."), failed)
      : Effect.andThen(Console.error(readErrorLine(error)), failed),
  ),
  Effect.provide(ThingsSource.layer),
);

await Effect.runPromise(program);

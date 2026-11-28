import { Clock, Effect } from "effect";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { CurrentWorker, acting, ownerQuery, reading, workerAction, workerMutation, writing } from "../platform/effect";
import { requireCapability } from "../platform/workers";
import { asWire, wireToEffect } from "../../shared/effect/wire";
import type { SerialisedResult } from "../../shared/result";
import { NeverImported, Retired } from "./thingsErrors";
import { syncState, type ImportError, type StageCounts } from "./thingsImport";
import { fromThingsRows, vThingsRows, type Skipped, type ThingsRows } from "./thingsRows";

const BATCH_SIZE = 200;

const tables = ["areas", "labels", "projects", "headings", "tasks", "checklistItems"] as const;

type Table = (typeof tables)[number];
type StageResult = SerialisedResult<{ counts: StageCounts; skipped: Skipped[] }, ImportError>;

export type ImportReport = Record<Table, StageCounts> & { skipped: Skipped[] };
export type RetireError = { readonly kind: "never_imported" };

const importArgs = { rows: vThingsRows };

type ImportRows = ReturnType<typeof workerAction<typeof importArgs, SerialisedResult<ImportReport, ImportError>>>;

const stagedBy = <A>(staged: SerialisedResult<A, ImportError>) =>
  wireToEffect(staged).pipe(Effect.mapError(({ retiredAt }) => new Retired({ retiredAt })));

const emptyReport = (skipped: Skipped[]) => ({
  areas: { inserted: 0, updated: 0, unchanged: 0 },
  labels: { inserted: 0, updated: 0, unchanged: 0 },
  projects: { inserted: 0, updated: 0, unchanged: 0 },
  headings: { inserted: 0, updated: 0, unchanged: 0 },
  tasks: { inserted: 0, updated: 0, unchanged: 0 },
  checklistItems: { inserted: 0, updated: 0, unchanged: 0 },
  skipped,
}) satisfies ImportReport;

const importAll = Effect.fn("things.importAll")(function* (rows: ThingsRows) {
  const retiredAt = yield* acting((ctx) => ctx.runQuery(internal.planner.thingsImport.retiredAt, {}));
  if (retiredAt !== null) return yield* new Retired({ retiredAt });

  const incoming = fromThingsRows(rows);
  const stages = {
    areas: (ctx, from, to) => ctx.runMutation(internal.planner.thingsImport.importAreas, { records: incoming.areas.slice(from, to) }),
    labels: (ctx, from, to) =>
      ctx.runMutation(internal.planner.thingsImport.importLabels, { records: incoming.labels.slice(from, to) }),
    projects: (ctx, from, to) =>
      ctx.runMutation(internal.planner.thingsImport.importProjects, { records: incoming.projects.slice(from, to) }),
    headings: (ctx, from, to) =>
      ctx.runMutation(internal.planner.thingsImport.importHeadings, { records: incoming.headings.slice(from, to) }),
    tasks: (ctx, from, to) => ctx.runMutation(internal.planner.thingsImport.importTasks, { records: incoming.tasks.slice(from, to) }),
    checklistItems: (ctx, from, to) =>
      ctx.runMutation(internal.planner.thingsImport.importChecklistItems, {
        records: incoming.checklistItems.slice(from, to),
      }),
  } satisfies Record<Table, (ctx: ActionCtx, from: number, to: number) => Promise<StageResult>>;

  const report = emptyReport([...incoming.skipped]);
  for (const table of tables) {
    for (let from = 0; from < incoming[table].length; from += BATCH_SIZE) {
      const staged = yield* acting((ctx) => stages[table](ctx, from, from + BATCH_SIZE));
      const batch = yield* stagedBy(staged);
      report[table].inserted += batch.counts.inserted;
      report[table].updated += batch.counts.updated;
      report[table].unchanged += batch.counts.unchanged;
      report.skipped.push(...batch.skipped);
    }
  }

  const counts = Object.fromEntries(tables.map((table) => [table, incoming[table].length])) as Record<Table, number>;
  yield* stagedBy(yield* acting((ctx) => ctx.runMutation(internal.planner.thingsImport.finish, { counts })));
  return report;
});

export const importRows: ImportRows = workerAction({
  args: importArgs,
  handler: Effect.fn("things.importRows")(function* ({ rows }) {
    requireCapability(yield* CurrentWorker, "things");
    return yield* asWire(importAll(rows));
  }),
});

const retireThings = Effect.fn("things.retireThings")(function* () {
  const state = yield* reading(syncState);
  if (!state) return yield* new NeverImported();
  if (state.retiredAt !== undefined) return { retiredAt: state.retiredAt };
  const retiredAt = yield* Clock.currentTimeMillis;
  yield* writing((ctx) => ctx.db.patch("thingsSync", state._id, { retiredAt }));
  return { retiredAt };
});

export const retire = workerMutation({
  args: {},
  handler: Effect.fn("things.retire")(function* () {
    requireCapability(yield* CurrentWorker, "things");
    return yield* asWire(retireThings());
  }),
});

export const status = ownerQuery({
  args: {},
  handler: () => reading(syncState),
});

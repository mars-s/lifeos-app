import { err, ok } from "neverthrow";
import { internal } from "../_generated/api";
import { ownerQuery, workerAction, workerMutation } from "../platform/access";
import { requireCapability } from "../platform/workers";
import { serialise, type SerialisedResult } from "../../shared/result";
import { syncState, type ImportError, type StageCounts } from "./thingsImport";
import { fromThingsRows, vThingsRows, type Skipped } from "./thingsRows";

const BATCH_SIZE = 200;

const tables = ["areas", "labels", "projects", "headings", "tasks", "checklistItems"] as const;

type Table = (typeof tables)[number];
type StageResult = SerialisedResult<{ counts: StageCounts; skipped: Skipped[] }, ImportError>;

export type ImportReport = Record<Table, StageCounts> & { skipped: Skipped[] };
export type RetireError = { readonly kind: "never_imported" };

const importArgs = { rows: vThingsRows };

type ImportRows = ReturnType<typeof workerAction<typeof importArgs, SerialisedResult<ImportReport, ImportError>>>;

export const importRows: ImportRows = workerAction({
  args: importArgs,
  handler: async (ctx, { rows }, worker) => {
    requireCapability(worker, "things");
    const retiredAt: number | null = await ctx.runQuery(internal.planner.thingsImport.retiredAt, {});
    if (retiredAt !== null) return serialise(err<ImportReport, ImportError>({ kind: "retired", retiredAt }));

    const incoming = fromThingsRows(rows);
    const stages: Record<Table, (from: number, to: number) => Promise<StageResult>> = {
      areas: (from, to) => ctx.runMutation(internal.planner.thingsImport.importAreas, { records: incoming.areas.slice(from, to) }),
      labels: (from, to) =>
        ctx.runMutation(internal.planner.thingsImport.importLabels, { records: incoming.labels.slice(from, to) }),
      projects: (from, to) =>
        ctx.runMutation(internal.planner.thingsImport.importProjects, { records: incoming.projects.slice(from, to) }),
      headings: (from, to) =>
        ctx.runMutation(internal.planner.thingsImport.importHeadings, { records: incoming.headings.slice(from, to) }),
      tasks: (from, to) => ctx.runMutation(internal.planner.thingsImport.importTasks, { records: incoming.tasks.slice(from, to) }),
      checklistItems: (from, to) =>
        ctx.runMutation(internal.planner.thingsImport.importChecklistItems, {
          records: incoming.checklistItems.slice(from, to),
        }),
    };

    const report: ImportReport = {
      areas: { inserted: 0, updated: 0, unchanged: 0 },
      labels: { inserted: 0, updated: 0, unchanged: 0 },
      projects: { inserted: 0, updated: 0, unchanged: 0 },
      headings: { inserted: 0, updated: 0, unchanged: 0 },
      tasks: { inserted: 0, updated: 0, unchanged: 0 },
      checklistItems: { inserted: 0, updated: 0, unchanged: 0 },
      skipped: [...incoming.skipped],
    };
    for (const table of tables) {
      for (let from = 0; from < incoming[table].length; from += BATCH_SIZE) {
        const result: StageResult = await stages[table](from, from + BATCH_SIZE);
        if (!result.ok) return serialise(err<ImportReport, ImportError>(result.error));
        report[table].inserted += result.value.counts.inserted;
        report[table].updated += result.value.counts.updated;
        report[table].unchanged += result.value.counts.unchanged;
        report.skipped.push(...result.value.skipped);
      }
    }

    const counts = Object.fromEntries(tables.map((table) => [table, incoming[table].length])) as Record<Table, number>;
    const finished: SerialisedResult<{ syncedAt: number }, ImportError> = await ctx.runMutation(
      internal.planner.thingsImport.finish,
      { counts },
    );
    return finished.ok
      ? serialise(ok<ImportReport, ImportError>(report))
      : serialise(err<ImportReport, ImportError>(finished.error));
  },
});

export const retire = workerMutation({
  args: {},
  handler: async (ctx, _args, worker) => {
    requireCapability(worker, "things");
    const state = await syncState(ctx);
    if (!state) return serialise(err<{ retiredAt: number }, RetireError>({ kind: "never_imported" }));
    if (state.retiredAt !== undefined) return serialise(ok<{ retiredAt: number }, RetireError>({ retiredAt: state.retiredAt }));
    const retiredAt = Date.now();
    await ctx.db.patch("thingsSync", state._id, { retiredAt });
    return serialise(ok<{ retiredAt: number }, RetireError>({ retiredAt }));
  },
});

export const status = ownerQuery({
  args: {},
  handler: (ctx) => syncState(ctx),
});

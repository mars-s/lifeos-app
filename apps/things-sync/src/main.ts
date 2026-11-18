import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { ResultAsync } from "neverthrow";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import { deserialise } from "@lifeos/backend/result";
import { dryRunCounts, importLines, readErrorLine, retiredLine } from "./report.ts";
import { findThingsDatabase, readSyncToken, readThingsRows } from "./things.ts";

const WATCH_EVERY_MS = 5 * 60_000;

type ConvexError = { readonly kind: "convex_rejected"; readonly detail: string };

const { values } = parseArgs({
  options: {
    watch: { type: "boolean", default: false },
    switch: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const clock = () => new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

const readRows = () => findThingsDatabase().andThen(readThingsRows);

const dryRun = async () => {
  const rows = await readRows();
  if (rows.isErr()) {
    console.error(readErrorLine(rows.error));
    process.exitCode = 1;
    return;
  }
  console.log("Things, as read now (nothing was sent to LifeOS):");
  for (const [label, count] of dryRunCounts(rows.value, localIsoDate(new Date()))) console.log(`  ${label}: ${count}`);
};

const convexUrl = process.env.CONVEX_URL;

const convex = () => {
  if (!convexUrl) {
    console.error("Set CONVEX_URL in apps/things-sync/.env.local (see .env.example).");
    process.exit(1);
  }
  return new ConvexHttpClient(convexUrl);
};

const rejected = (error: unknown) =>
  ({ kind: "convex_rejected", detail: error instanceof Error ? error.message : String(error) }) satisfies ConvexError;

const importOnce = async (client: ConvexHttpClient, token: string) => {
  const rows = await readRows();
  if (rows.isErr()) {
    console.error(`${clock()} ${readErrorLine(rows.error)}`);
    process.exitCode = 1;
    return "failed" as const;
  }
  const sent = await ResultAsync.fromPromise(client.action(api.planner.things.importRows, { token, rows: rows.value }), rejected);
  if (sent.isErr()) {
    console.error(`${clock()} LifeOS refused the import: ${sent.error.detail}`);
    process.exitCode = 1;
    return "failed" as const;
  }
  const imported = deserialise(sent.value);
  if (imported.isErr()) {
    console.log(retiredLine(imported.error.retiredAt));
    process.exitCode = 0;
    return "retired" as const;
  }
  console.log(`${clock()} Imported from Things into LifeOS:`);
  for (const line of importLines(imported.value)) console.log(line);
  return "imported" as const;
};

const switchDay = async (client: ConvexHttpClient, token: string) => {
  const outcome = await importOnce(client, token);
  if (outcome !== "imported") return;
  const retired = await ResultAsync.fromPromise(client.mutation(api.planner.things.retire, { token }), rejected);
  if (retired.isErr()) {
    console.error(`LifeOS could not retire Things: ${retired.error.detail}`);
    process.exitCode = 1;
    return;
  }
  deserialise(retired.value).match(
    ({ retiredAt }) => {
      console.log(retiredLine(retiredAt));
      console.log("That was the final import. Every Task now lives in LifeOS, and nothing is read from Things again.");
    },
    () => {
      console.error("LifeOS has no import from Things yet, so there is nothing to retire.");
      process.exitCode = 1;
    },
  );
};

const main = async () => {
  if (values["dry-run"]) return dryRun();
  const client = convex();
  const token = await readSyncToken();
  if (token.isErr()) {
    console.error(readErrorLine(token.error));
    process.exitCode = 1;
    return;
  }
  if (values.switch) return switchDay(client, token.value);
  for (;;) {
    const outcome = await importOnce(client, token.value);
    if (!values.watch || outcome === "retired") return;
    await sleep(WATCH_EVERY_MS);
  }
};

await main();

import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { ResultAsync } from "neverthrow";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import { toSnapshot } from "./snapshot.ts";
import { readSyncToken, readThings } from "./things.ts";

type SyncError = { readonly kind: "convex_rejected"; readonly detail: string };

const { values } = parseArgs({
  options: { watch: { type: "boolean", default: false }, every: { type: "string", default: "120" } },
});

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  console.error("Set CONVEX_URL in apps/things-sync/.env.local (see .env.example).");
  process.exit(1);
}
const client = new ConvexHttpClient(convexUrl);

const syncOnce = () =>
  readSyncToken()
    .andThen((token) => readThings().andThen((raw) => toSnapshot(raw, localIsoDate(new Date()))).map((snapshot) => ({ token, snapshot })))
    .andThen(({ token, snapshot }) =>
      ResultAsync.fromPromise(
        client.mutation(api.planner.things.sync, { token, snapshot }),
        (error) =>
          ({ kind: "convex_rejected", detail: error instanceof Error ? error.message : String(error) }) satisfies SyncError,
      ).map((changes) => ({ changes, total: snapshot.tasks.length })),
    );

const report = async () => {
  const result = await syncOnce();
  const time = new Date().toLocaleTimeString("en-AU");
  result.match(
    ({ changes, total }) => {
      const { inserted, updated, departed } = changes.tasks;
      console.log(`${time} Synced ${total} tasks from Things (${inserted} new, ${updated} changed, ${departed} left Things).`);
    },
    (error) => {
      console.error(`${time} Sync failed: ${JSON.stringify(error)}`);
      process.exitCode = 1;
    },
  );
};

await report();
if (values.watch) {
  const seconds = Math.max(15, Number(values.every) || 120);
  setInterval(() => void report(), seconds * 1000);
}

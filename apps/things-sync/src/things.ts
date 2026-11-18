import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ResultAsync } from "neverthrow";
import type { RawThings } from "./snapshot.ts";

const run = promisify(execFile);
const READER = new URL("./read-things.jxa.js", import.meta.url).pathname;

export type ReadError = { readonly kind: "things_unreadable"; readonly detail: string };
export type TokenError = { readonly kind: "token_missing" };

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const readThings = () =>
  ResultAsync.fromPromise(
    run("osascript", ["-l", "JavaScript", READER], { maxBuffer: 32 * 1024 * 1024 }),
    (error) => ({ kind: "things_unreadable", detail: detailOf(error) }) satisfies ReadError,
  ).map(({ stdout }) => JSON.parse(stdout) as RawThings);

export const readSyncToken = () => {
  const fromEnv = process.env.LIFEOS_THINGS_SYNC_TOKEN;
  if (fromEnv) return ResultAsync.fromSafePromise(Promise.resolve(fromEnv));
  return ResultAsync.fromPromise(
    run("security", ["find-generic-password", "-s", "lifeos-app-things-sync", "-a", process.env.USER ?? "", "-w"]),
    () => ({ kind: "token_missing" }) satisfies TokenError,
  ).map(({ stdout }) => stdout.trim());
};

/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import type { SerialisedResult } from "../shared/result";
import { sha256Hex } from "./platform/workers";
import schema from "./schema";
import type { JobKind } from "./platform/tables";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);

export const newBackend = () => convexTest(schema, modules);

export type Backend = ReturnType<typeof newBackend>;

export const registerWorker = async (t: Backend, name: string, capabilities: JobKind[]) => {
  const token = `${name}-token`;
  await t.mutation(internal.platform.workers.register, { name, capabilities, tokenHash: await sha256Hex(token) });
  return token;
};

export const drainJobs = async (t: Backend, token: string) => {
  const claimed = [];
  for (let job = await t.mutation(api.platform.jobs.claim, { token }); job; job = await t.mutation(api.platform.jobs.claim, { token })) {
    claimed.push(job);
    await t.mutation(api.platform.jobs.complete, { token, jobId: job.jobId, receipt: null });
  }
  return claimed;
};

export const unwrap = <T, E>(result: SerialisedResult<T, E>) => {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

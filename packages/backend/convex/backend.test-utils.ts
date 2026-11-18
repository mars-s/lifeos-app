/// <reference types="vite/client" />
import { registerCore, sessionIdentity } from "@convex-dev/auth/test";
import { registerGithubOauth } from "@convex-dev/auth/components/github/test";
import { register as registerMcp } from "@convex-dev/mcp/test";
import { createFunctionHandle } from "convex/server";
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { SerialisedResult } from "../shared/result";
import { sha256Hex } from "./platform/workers";
import schema from "./schema";
import type { JobKind } from "./platform/tables";

const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);

export const ownerGithubId = "1001";

export const newSignedOutBackend = () => {
  vi.stubEnv("LIFEOS_OWNER_GITHUB_ID", ownerGithubId);
  vi.stubEnv("CONVEX_CLOUD_URL", "https://lifeos-test.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://lifeos-test.convex.site");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  const t = convexTest(schema, modules);
  registerCore(t);
  registerGithubOauth(t);
  registerMcp(t);
  return t;
};

export type SignedOutBackend = ReturnType<typeof newSignedOutBackend>;

export const signInWithGithub = async (t: SignedOutBackend, githubId: string, login: string) => {
  const tokens = await t.run(async (ctx) =>
    ctx.runMutation(components.auth.public._internal_dangerous_signUp, {
      claims: { method: "github", profile: { id: githubId, login, emailVerified: false } },
      componentPath: "authGithub",
      createUserHandle: await createFunctionHandle(internal.platform.access.createUser),
      onSignInHandle: await createFunctionHandle(internal.platform.access.onSignIn),
      accessTokenTtlSeconds: 60,
      refreshInactivityTimeoutSeconds: 3600,
      sessionMaxLifetimeSeconds: 3600,
    }),
  );
  return t.withIdentity(sessionIdentity(tokens));
};

export const newBackend = async () => signInWithGithub(newSignedOutBackend(), ownerGithubId, "avi");

export type Backend = Awaited<ReturnType<typeof newBackend>>;

export const registerWorker = async (t: Backend, name: string, capabilities: JobKind[]) => {
  const token = `${name}-token`;
  await t.mutation(internal.platform.workers.register, { name, capabilities, tokenHash: await sha256Hex(token) });
  return token;
};

export const drainJobs = async (t: Backend, token: string) => {
  const claimed = [];
  for (let job = await t.mutation(api.platform.jobs.claim, { token }); job; job = await t.mutation(api.platform.jobs.claim, { token })) {
    claimed.push(job);
    await t.mutation(api.platform.jobs.complete, { token, jobId: job.jobId, attempt: job.attempts, receipt: null });
  }
  return claimed;
};

export const unwrap = <T, E>(result: SerialisedResult<T, E>) => {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

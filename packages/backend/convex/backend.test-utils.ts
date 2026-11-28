/// <reference types="vite/client" />
import { registerCore, sessionIdentity } from "@convex-dev/auth/test";
import { registerGithubOauth } from "@convex-dev/auth/components/github/test";
import { register as registerMcp } from "@convex-dev/mcp/test";
import { register as registerAgent } from "@convex-dev/agent/test";
import { createFunctionHandle } from "convex/server";
import { convexTest } from "convex-test";
import { Effect } from "effect";
import { vi } from "vitest";
import { components, internal } from "./_generated/api";
import { PROVIDERS } from "../shared/ai";
import type { SerialisedResult } from "../shared/result";
import { Reads, runAtEdge, Writes } from "./platform/effect";
import { sha256Hex } from "./platform/workers";
import schema from "./schema";
import type { Capability } from "./platform/tables";

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
  registerAgent(t);
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

export const strangerSession = async (t: SignedOutBackend) => {
  const userId = await t.run((ctx) => ctx.db.insert("users", { githubId: "2002", login: "stranger" }));
  const tokens = await t.run(async (ctx) =>
    ctx.runMutation(components.auth.public._internal_dangerous_signIn, {
      claims: { method: "github", profile: { id: "2002", login: "stranger", emailVerified: false } },
      componentPath: "authGithub",
      userId,
      accessTokenTtlSeconds: 60,
      refreshInactivityTimeoutSeconds: 3600,
      sessionMaxLifetimeSeconds: 3600,
    }),
  );
  return t.withIdentity(sessionIdentity(tokens));
};

export const newBackend = async () => signInWithGithub(newSignedOutBackend(), ownerGithubId, "avi");

export type Backend = Awaited<ReturnType<typeof newBackend>>;

export const DECISIONS_URL = `${PROVIDERS.openai.baseUrl}/decisions`;
export const OPENAI_CHAT_URL = `${PROVIDERS.openai.baseUrl}/chat/completions`;
export const GO_CHAT_URL = `${PROVIDERS.opencodeGo.baseUrl}/chat/completions`;

export const switchAiOn = (t: Backend, routes: Record<string, { on: boolean; model: string }> = {}) =>
  t.run(async (ctx) => {
    await ctx.db.insert("features", { feature: "ai", enabled: true, settings: { routes } });
  });

export const newAiBackend = async () => {
  const t = await newBackend();
  await switchAiOn(t);
  return t;
};

export const registerWorker = async (t: Backend, name: string, capabilities: Capability[]) => {
  const token = `${name}-token`;
  await t.mutation(internal.platform.workers.register, { name, capabilities, tokenHash: await sha256Hex(token) });
  return token;
};

export const unwrap = <T, E>(result: SerialisedResult<T, E>) => {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

export const refusal = async (call: Promise<unknown>) => {
  const thrown: unknown = await call.then(
    () => null,
    (error: unknown) => error,
  );
  const data = thrown && typeof thrown === "object" && "data" in thrown ? thrown.data : null;
  return data && typeof data === "object" && "kind" in data ? data.kind : thrown;
};

export const runIn = <A, E>(t: Pick<SignedOutBackend, "run">, effect: Effect.Effect<A, E, Reads | Writes>) =>
  t.run((ctx) => runAtEdge(effect.pipe(Effect.orDie, Effect.provideService(Writes, ctx), Effect.provideService(Reads, ctx))));

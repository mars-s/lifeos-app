import { v } from "convex/values";
import { Clock, Context, Effect, Layer, Option, Redacted, Result } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, type ActionCtx, type QueryCtx } from "../_generated/server";
import { PROVIDERS, USER_AGENT } from "../../shared/ai";
import { asWire } from "../../shared/effect/wire";
import type { SerialisedResult } from "../../shared/result";
import type { ownerAction as guardedAction } from "./access";
import { Acts, acting, internalMutation, internalQuery, ownerAction, ownerQuery, reading, runAtEdge, writing } from "./effect";
import { EmptySecret, KeyCheckUnavailable, KeyCheckUnreachable, KeyRefused, SecretsNotSetUp } from "./errors";
import { vSecretName, type SecretName } from "./tables";

export type SecretError =
  | { readonly kind: "empty" }
  | { readonly kind: "not_set_up" }
  | { readonly kind: "refused" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unavailable"; readonly status: number };

export type SavedSecret = { readonly last4: string; readonly savedAt: number };

type Sealed = { readonly iv: string; readonly ciphertext: string };

type SealingKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const SEALING_KEY_BYTES = 32;
const IV_BYTES = 12;

const KEY_CHECK_URLS = {
  openai: PROVIDERS.openai.keyCheckUrl,
  opencodeGo: PROVIDERS.opencodeGo.keyCheckUrl,
} satisfies Record<SecretName, string>;

const keysFromEnv = () =>
  ({ openai: env.OPENAI_API_KEY, opencodeGo: env.OPENCODE_GO_API_KEY }) satisfies Record<SecretName, string | undefined>;

const bytesOf = (base64: string) =>
  Result.try({
    try: () => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
    catch: () => new SecretsNotSetUp(),
  });

const base64Of = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const boundTo = (name: SecretName) => new TextEncoder().encode(`lifeos-secret:${name}`);

const crypt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => new SecretsNotSetUp() });

const importSealingKey = Effect.fn("secrets.importSealingKey")(function* (raw: Redacted.Redacted<string> | undefined) {
  if (!raw) return yield* new SecretsNotSetUp();
  const bytes = yield* Effect.fromResult(bytesOf(Redacted.value(raw).trim()));
  if (bytes.length !== SEALING_KEY_BYTES) return yield* new SecretsNotSetUp();
  return yield* crypt(() => crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]));
});

const sealWith = Effect.fn("secrets.seal")(function* (key: SealingKey, name: SecretName, value: Redacted.Redacted<string>) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(Redacted.value(value));
  const ciphertext = yield* crypt(() => crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(name) }, key, plain));
  const sealed: Sealed = { iv: base64Of(iv), ciphertext: base64Of(new Uint8Array(ciphertext)) };
  return sealed;
});

const unsealWith = Effect.fn("secrets.unseal")(function* (key: SealingKey, row: Doc<"secrets">) {
  const iv = yield* Effect.fromResult(bytesOf(row.iv));
  const ciphertext = yield* Effect.fromResult(bytesOf(row.ciphertext));
  const plain = yield* crypt(() => crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: boundTo(row.name) }, key, ciphertext));
  return Redacted.make(new TextDecoder().decode(plain));
});

const sealedRow = (ctx: ActionCtx, name: SecretName) => {
  const row: Promise<Doc<"secrets"> | null> = ctx.runQuery(internal.platform.secrets.sealed, { name });
  return Effect.promise(() => row);
};

export class Secrets extends Context.Service<
  Secrets,
  {
    ready: Effect.Effect<void, SecretsNotSetUp>;
    seal(name: SecretName, value: Redacted.Redacted<string>): Effect.Effect<Sealed, SecretsNotSetUp>;
    reveal(name: SecretName): Effect.Effect<Option.Option<Redacted.Redacted<string>>>;
  }
>()("lifeos/platform/Secrets") {
  static readonly layer = Layer.effect(
    Secrets,
    Effect.gen(function* () {
      const ctx = yield* Acts;
      const raw = env.LIFEOS_SECRETS_KEY;
      const sealingKey = importSealingKey(raw === undefined ? undefined : Redacted.make(raw));
      const fromEnv = keysFromEnv();
      return Secrets.of({
        ready: Effect.asVoid(sealingKey),
        seal: (name, value) => Effect.flatMap(sealingKey, (key) => sealWith(key, name, value)),
        reveal: Effect.fn("Secrets.reveal")(function* (name: SecretName) {
          const row = yield* sealedRow(ctx, name);
          const stored = row ? yield* Effect.option(Effect.flatMap(sealingKey, (key) => unsealWith(key, row))) : Option.none();
          return Option.orElse(stored, () => Option.map(Option.fromNullishOr(fromEnv[name]), Redacted.make));
        }),
      });
    }),
  );

  static readonly layerTest = (keys: Partial<Record<SecretName, string>>, sealing: "ready" | "not_set_up" = "ready") => {
    const ready = sealing === "ready" ? Effect.void : Effect.fail(new SecretsNotSetUp());
    return Layer.succeed(
      Secrets,
      Secrets.of({
        ready,
        seal: (name, value) => Effect.as(ready, { iv: "test", ciphertext: `${name}:${Redacted.value(value).length}` }),
        reveal: (name) => Effect.succeed(Option.map(Option.fromNullishOr(keys[name]), Redacted.make)),
      }),
    );
  };
}

const checkKey = Effect.fn("secrets.checkKey")(function* (name: SecretName, key: Redacted.Redacted<string>) {
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(KEY_CHECK_URLS[name]).pipe(
    HttpClientRequest.bearerToken(Redacted.value(key)),
    HttpClientRequest.setHeader("user-agent", USER_AGENT),
  );
  const response = yield* client.execute(request).pipe(Effect.mapError(() => new KeyCheckUnreachable()));
  if (response.status === 401 || response.status === 403) return yield* new KeyRefused();
  if (response.status < 200 || response.status > 299) return yield* new KeyCheckUnavailable({ status: response.status });
});

export const saveSecret = Effect.fn("secrets.save")(function* (name: SecretName, value: string) {
  const trimmed = value.trim();
  if (trimmed === "") return yield* new EmptySecret();
  const secrets = yield* Secrets;
  const key = Redacted.make(trimmed);
  yield* secrets.ready;
  yield* checkKey(name, key);
  const sealed = yield* secrets.seal(name, key);
  const saved: SavedSecret = { last4: trimmed.slice(-4), savedAt: yield* Clock.currentTimeMillis };
  yield* acting((ctx) => {
    const stored: Promise<null> = ctx.runMutation(internal.platform.secrets.store, { name, ...sealed, ...saved });
    return stored;
  });
  return saved;
});

const secretRow = (ctx: QueryCtx, name: SecretName) =>
  ctx.db
    .query("secrets")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();

export const secretAvailable = async (ctx: QueryCtx, name: SecretName) =>
  ((await secretRow(ctx, name)) !== null && env.LIFEOS_SECRETS_KEY !== undefined) || keysFromEnv()[name] !== undefined;

export const revealSecret = async (ctx: ActionCtx, name: SecretName) =>
  Option.getOrUndefined(
    Option.map(
      await runAtEdge(Secrets.use((secrets) => secrets.reveal(name)).pipe(Effect.provide(Secrets.layer), Effect.provideService(Acts, ctx))),
      Redacted.value,
    ),
  );

export const status = ownerQuery({
  args: { name: vSecretName },
  handler: ({ name }) =>
    reading(async (ctx) => {
      const row = await secretRow(ctx, name);
      return row ? ({ last4: row.last4, savedAt: row.savedAt } satisfies SavedSecret) : null;
    }),
});

export const available = ownerQuery({
  args: { name: vSecretName },
  handler: ({ name }) => reading((ctx) => secretAvailable(ctx, name)),
});

const saveArgs = { name: vSecretName, value: v.string() };

type Save = ReturnType<typeof guardedAction<typeof saveArgs, SerialisedResult<SavedSecret, SecretError>>>;

export const save: Save = ownerAction({
  args: saveArgs,
  handler: ({ name, value }) =>
    asWire(saveSecret(name, value)).pipe(Effect.provide(Secrets.layer), Effect.provide(FetchHttpClient.layer)),
});

const removeArgs = { name: vSecretName };

type Remove = ReturnType<typeof guardedAction<typeof removeArgs, null>>;

export const remove: Remove = ownerAction({
  args: removeArgs,
  handler: ({ name }) =>
    acting((ctx) => {
      const forgotten: Promise<null> = ctx.runMutation(internal.platform.secrets.forget, { name });
      return forgotten;
    }),
});

export const sealed = internalQuery({
  args: { name: vSecretName },
  handler: ({ name }) => reading((ctx) => secretRow(ctx, name)),
});

export const store = internalMutation({
  args: { name: vSecretName, iv: v.string(), ciphertext: v.string(), last4: v.string(), savedAt: v.number() },
  returns: v.null(),
  handler: (row) =>
    writing(async (ctx) => {
      const existing = await secretRow(ctx, row.name);
      if (existing) await ctx.db.replace("secrets", existing._id, row);
      else await ctx.db.insert("secrets", row);
      return null;
    }),
});

export const forget = internalMutation({
  args: { name: vSecretName },
  returns: v.null(),
  handler: ({ name }) =>
    writing(async (ctx) => {
      const existing = await secretRow(ctx, name);
      if (existing) await ctx.db.delete("secrets", existing._id);
      return null;
    }),
});

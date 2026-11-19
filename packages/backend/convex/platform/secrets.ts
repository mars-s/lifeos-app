import { v } from "convex/values";
import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server";
import { serialise, type SerialisedResult } from "../../shared/result";
import { ownerAction, ownerQuery } from "./access";
import { vSecretName, type SecretName } from "./tables";

export type SecretError =
  | { readonly kind: "empty" }
  | { readonly kind: "not_set_up" }
  | { readonly kind: "refused" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "unavailable"; readonly status: number };

export type SavedSecret = { readonly last4: string; readonly savedAt: number };

export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

const SEALING_KEY_BYTES = 32;
const IV_BYTES = 12;

const SECRETS = {
  openai: {
    fromEnv: () => env.OPENAI_API_KEY,
    check: (key: string) => fetch(OPENAI_MODELS_URL, { headers: { authorization: `Bearer ${key}` } }),
  },
} satisfies Record<SecretName, { fromEnv: () => string | undefined; check: (key: string) => Promise<Response> }>;

const bytesOf = Result.fromThrowable(
  (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
  () => ({ kind: "not_set_up" }) as const,
);

const base64Of = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const sealingKey = () => {
  const notSetUp = { kind: "not_set_up" } as const;
  const raw = env.LIFEOS_SECRETS_KEY;
  if (!raw) return errAsync(notSetUp);
  return bytesOf(raw.trim())
    .andThen((bytes) => (bytes.length === SEALING_KEY_BYTES ? ok(bytes) : err(notSetUp)))
    .asyncAndThen((bytes) =>
      ResultAsync.fromPromise(crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]), () => notSetUp),
    );
};

const boundTo = (name: SecretName) => new TextEncoder().encode(`lifeos-secret:${name}`);

const seal = (name: SecretName, value: string) =>
  sealingKey().andThen((key) => {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    return ResultAsync.fromPromise(
      crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(name) }, key, new TextEncoder().encode(value)),
      () => ({ kind: "not_set_up" }) as const,
    ).map((ciphertext) => ({ iv: base64Of(iv), ciphertext: base64Of(new Uint8Array(ciphertext)) }));
  });

const unseal = (row: Doc<"secrets">) =>
  sealingKey().andThen((key) =>
    Result.combine([bytesOf(row.iv), bytesOf(row.ciphertext)]).asyncAndThen(([iv, ciphertext]) =>
      ResultAsync.fromPromise(
        crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: boundTo(row.name) }, key, ciphertext),
        () => ({ kind: "not_set_up" }) as const,
      ).map((plain) => new TextDecoder().decode(plain)),
    ),
  );

const checked = (name: SecretName, value: string) => {
  const unreachable: SecretError = { kind: "unreachable" };
  return ResultAsync.fromPromise(SECRETS[name].check(value), () => unreachable).andThen((response) => {
    if (response.ok) return okAsync(value);
    if (response.status === 401 || response.status === 403) return errAsync<string, SecretError>({ kind: "refused" });
    return errAsync<string, SecretError>({ kind: "unavailable", status: response.status });
  });
};

const secretRow = (ctx: QueryCtx, name: SecretName) =>
  ctx.db
    .query("secrets")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();

export const secretAvailable = async (ctx: QueryCtx, name: SecretName) =>
  ((await secretRow(ctx, name)) !== null && env.LIFEOS_SECRETS_KEY !== undefined) || SECRETS[name].fromEnv() !== undefined;

export const revealSecret = async (ctx: ActionCtx, name: SecretName) => {
  const row: Doc<"secrets"> | null = await ctx.runQuery(internal.platform.secrets.sealed, { name });
  const stored = row ? await unseal(row) : null;
  return stored?.isOk() ? stored.value : SECRETS[name].fromEnv();
};

export const status = ownerQuery({
  args: { name: vSecretName },
  handler: async (ctx, { name }) => {
    const row = await secretRow(ctx, name);
    return row ? ({ last4: row.last4, savedAt: row.savedAt } satisfies SavedSecret) : null;
  },
});

const saveArgs = { name: vSecretName, value: v.string() };

type Save = ReturnType<typeof ownerAction<typeof saveArgs, SerialisedResult<SavedSecret, SecretError>>>;

export const save: Save = ownerAction({
  args: saveArgs,
  handler: async (ctx, { name, value }) => {
    const trimmed = value.trim();
    if (trimmed === "") return serialise(err<SavedSecret, SecretError>({ kind: "empty" }));
    const result = await sealingKey()
      .andThen(() => checked(name, trimmed))
      .andThen((key) => seal(name, key))
      .andThen((sealed) => {
        const saved = { last4: trimmed.slice(-4), savedAt: Date.now() } satisfies SavedSecret;
        return ResultAsync.fromSafePromise(ctx.runMutation(internal.platform.secrets.store, { name, ...sealed, ...saved })).map(() => saved);
      });
    return serialise(result);
  },
});

const removeArgs = { name: vSecretName };

type Remove = ReturnType<typeof ownerAction<typeof removeArgs, null>>;

export const remove: Remove = ownerAction({
  args: removeArgs,
  handler: async (ctx, { name }) => {
    await ctx.runMutation(internal.platform.secrets.forget, { name });
    return null;
  },
});

export const sealed = internalQuery({
  args: { name: vSecretName },
  handler: (ctx, { name }) => secretRow(ctx, name),
});

export const store = internalMutation({
  args: { name: vSecretName, iv: v.string(), ciphertext: v.string(), last4: v.string(), savedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, row) => {
    const existing = await secretRow(ctx, row.name);
    if (existing) await ctx.db.replace("secrets", existing._id, row);
    else await ctx.db.insert("secrets", row);
    return null;
  },
});

export const forget = internalMutation({
  args: { name: vSecretName },
  returns: v.null(),
  handler: async (ctx, { name }) => {
    const existing = await secretRow(ctx, name);
    if (existing) await ctx.db.delete("secrets", existing._id);
    return null;
  },
});

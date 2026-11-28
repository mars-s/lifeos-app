import type { DefaultFunctionArgs, FunctionArgs, FunctionReference } from "convex/server";
import { Context, Effect, Layer } from "effect";
import { Atom } from "effect/reactivity";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SerialisedResult } from "../../result";
import { wireToEffect } from "../wire";

type AnyWire = SerialisedResult<unknown, { readonly kind: string }>;
type WireMutation = FunctionReference<"mutation", "public", DefaultFunctionArgs, AnyWire>;
type Saved<M extends WireMutation> = Extract<M["_returnType"], { ok: true }>["value"];
type Refusal<M extends WireMutation> = Extract<M["_returnType"], { ok: false }>["error"];
type Send = (mutation: WireMutation, args: DefaultFunctionArgs) => Promise<AnyWire>;

export class Backend extends Context.Service<
  Backend,
  {
    change<M extends WireMutation>(mutation: M, args: FunctionArgs<M>): Effect.Effect<Saved<M>, Refusal<M>>;
  }
>()("lifeos/client/Backend") {
  static readonly layer = (send: Send) =>
    Layer.succeed(
      Backend,
      Backend.of({
        change: <M extends WireMutation>(mutation: M, args: FunctionArgs<M>) =>
          Effect.promise(() => send(mutation, args) as Promise<SerialisedResult<Saved<M>, Refusal<M>>>).pipe(
            Effect.flatMap(wireToEffect),
          ),
      }),
    );
}

export type Face = "list" | "timeline";

export const faceAtom = Atom.make<Face>("list").pipe(Atom.keepAlive);

export const selectedAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);

export const selectedCountAtom = Atom.make((get) => get(selectedAtom).size);

export const toggleSelectedAtom = Atom.writable(
  (get) => get(selectedAtom),
  (ctx, key: string) => {
    const next = new Set(ctx.get(selectedAtom));
    if (!next.delete(key)) next.add(key);
    ctx.set(selectedAtom, next);
  },
);

export const renameTaskAtom = (runtime: Atom.AtomRuntime<Backend>) =>
  runtime.fn<{ taskId: Id<"tasks">; title: string }>()((args) =>
    Backend.use((backend) => backend.change(api.planner.tasks.rename, args)),
  );

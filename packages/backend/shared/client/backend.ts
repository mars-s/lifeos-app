import { getFunctionName, type DefaultFunctionArgs, type FunctionArgs, type FunctionReference } from "convex/server";
import { Context, Effect, Layer } from "effect";
import { type SerialisedResult, wireToEffect } from "../result";

type AnyWire = SerialisedResult<unknown, { readonly kind: string }>;
type WireMutation = FunctionReference<"mutation", "public", DefaultFunctionArgs, AnyWire>;
type Saved<M extends WireMutation> = Extract<M["_returnType"], { ok: true }>["value"];
type Refusal<M extends WireMutation> = Extract<M["_returnType"], { ok: false }>["error"];
type Send = (mutation: WireMutation, args: DefaultFunctionArgs) => Promise<AnyWire>;
type Answers = (name: string, args: DefaultFunctionArgs) => AnyWire;

const backendOver = (send: Send) =>
  Backend.of({
    change: <M extends WireMutation>(mutation: M, args: FunctionArgs<M>) =>
      Effect.promise(() => send(mutation, args) as Promise<SerialisedResult<Saved<M>, Refusal<M>>>).pipe(Effect.flatMap(wireToEffect)),
  });

export class Backend extends Context.Service<
  Backend,
  {
    change<M extends WireMutation>(mutation: M, args: FunctionArgs<M>): Effect.Effect<Saved<M>, Refusal<M>>;
  }
>()("lifeos/client/Backend") {
  static readonly layer = (send: Send) => Layer.succeed(Backend, backendOver(send));

  static readonly layerTest = (answers: Answers) =>
    Layer.succeed(
      Backend,
      backendOver(async (mutation, args) => answers(getFunctionName(mutation), args)),
    );
}

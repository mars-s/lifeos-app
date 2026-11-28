import { Cause, Effect, Exit, Result } from "effect";
import type { SerialisedResult } from "../result";

export type WireError = { readonly kind: string };

type OwnWire = { wire(): { readonly kind: string } };

export type Wire<E> = E extends OwnWire
  ? ReturnType<E["wire"]>
  : E extends Cause.YieldableError
    ? { readonly [K in Exclude<keyof E, keyof Cause.YieldableError | "_tag">]: E[K] }
    : E;

export type SameWire<Failure, Old> = [Wire<Failure>] extends [Old] ? ([Old] extends [Wire<Failure>] ? true : false) : false;

const hasOwnWire = (error: object): error is OwnWire => "wire" in error;

const untagged = (error: object) => Object.fromEntries(Object.entries(error).filter(([key]) => key !== "_tag"));

export const wireError = <E extends WireError>(error: E) => (hasOwnWire(error) ? error.wire() : untagged(error)) as Wire<E>;

export const resultToWire = <A, E extends WireError>(result: Result.Result<A, E>) => {
  const wire: SerialisedResult<A, Wire<E>> = Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false, error: wireError(result.failure) };
  return wire;
};

export const asWire = <A, E extends WireError, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.result(effect), resultToWire);

export const wireToResult = <A, E extends WireError>(wire: SerialisedResult<A, E>) =>
  wire.ok ? Result.succeed(wire.value) : Result.fail(untagged(wire.error) as E);

export const wireToEffect = <A, E extends WireError>(wire: SerialisedResult<A, E>) => Effect.fromResult(wireToResult(wire));

export const valueOrThrow = <A>(exit: Exit.Exit<A>) => {
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

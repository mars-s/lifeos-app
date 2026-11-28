import { Effect, Result } from "effect";
import { err, ok, type Result as Outcome } from "neverthrow";
import { wireError, type Wire, type WireError } from "./wire";

export const fromNeverthrow = <A, E>(result: Outcome<A, E>) =>
  result.isOk() ? Result.succeed<A>(result.value) : Result.fail<E>(result.error);

export const toNeverthrow = <A, E extends WireError>(result: Result.Result<A, E>) =>
  Result.isSuccess(result) ? ok<A, Wire<E>>(result.success) : err<A, Wire<E>>(wireError(result.failure));

export const effectFromNeverthrow = <A, E>(thunk: () => Outcome<A, E> | PromiseLike<Outcome<A, E>>) =>
  Effect.flatMap(
    Effect.promise(async () => thunk()),
    (result) => Effect.fromResult(fromNeverthrow(result)),
  );

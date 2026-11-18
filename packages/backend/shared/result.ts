import { err, ok, type Result } from "neverthrow";
import { v, type Validator } from "convex/values";

export type SerialisedResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const serialise = <T, E>(result: Result<T, E>) =>
  result.match<SerialisedResult<T, E>>(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

export const deserialise = <T, E>(serialised: SerialisedResult<T, E>) =>
  serialised.ok ? ok<T, E>(serialised.value) : err<T, E>(serialised.error);

export const vResult = <T extends Validator<unknown, "required", string>, E extends Validator<unknown, "required", string>>(
  value: T,
  error: E,
) =>
  v.union(
    v.object({ ok: v.literal(true), value }),
    v.object({ ok: v.literal(false), error }),
  );

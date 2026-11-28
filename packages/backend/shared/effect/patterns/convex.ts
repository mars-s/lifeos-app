import { Context, Effect, Result, Scheduler } from "effect";
import type { ObjectType, PropertyValidators } from "convex/values";
import type { MutationCtx, QueryCtx } from "../../../convex/_generated/server";
import { ownerMutation, ownerQuery as guardedQuery } from "../../../convex/platform/access";
import { startRecording, type Recorder as Recording } from "../../../convex/platform/activity";
import type { Actor } from "../../../convex/platform/tables";
import { resultToWire, valueOrThrow, type WireError } from "../wire";

export class Reads extends Context.Service<Reads, QueryCtx>()("lifeos/platform/Reads") {}

export class Recorder extends Context.Service<Recorder, Recording>()("lifeos/platform/Recorder") {}

export class CurrentActor extends Context.Service<CurrentActor, Actor>()("lifeos/platform/CurrentActor") {}

export const reading = <A>(read: (ctx: QueryCtx) => Promise<A>) => Reads.use((ctx) => Effect.promise(() => read(ctx)));

export const recording = <A>(write: (record: Recording) => Promise<A>) =>
  Recorder.use((record) => Effect.promise(() => write(record)));

const insideConvex = new Scheduler.MixedScheduler("sync");

export const runAtEdge = async <A>(effect: Effect.Effect<A>) =>
  valueOrThrow(await Effect.runPromiseExit(effect, { scheduler: insideConvex }));

type QuerySpec<Args extends PropertyValidators, A> = {
  args: Args;
  handler: (args: ObjectType<Args>) => Effect.Effect<A, never, Reads>;
};

export const queryHandler =
  <Args extends PropertyValidators, A>(spec: QuerySpec<Args, A>) =>
  (ctx: QueryCtx, args: ObjectType<Args>) =>
    runAtEdge(spec.handler(args).pipe(Effect.provideService(Reads, ctx)));

export const ownerQuery = <Args extends PropertyValidators, A>(spec: QuerySpec<Args, A>) =>
  guardedQuery({ args: spec.args, handler: queryHandler(spec) });

type ChangeSpec<Args extends PropertyValidators, A extends object, E extends WireError> = {
  action: string;
  args: Args;
  handler: (args: ObjectType<Args>) => Effect.Effect<A, E, Reads | Recorder | CurrentActor>;
};

export const changeHandler =
  <Args extends PropertyValidators, A extends object, E extends WireError>(spec: ChangeSpec<Args, A, E>) =>
  async (ctx: MutationCtx, args: ObjectType<Args>, actor: Actor) => {
    const record = startRecording(ctx, actor, spec.action);
    const outcome = await runAtEdge(
      Effect.result(spec.handler(args)).pipe(
        Effect.provideService(Reads, ctx),
        Effect.provideService(Recorder, record),
        Effect.provideService(CurrentActor, actor),
      ),
    );
    const activityId = await record.finish();
    if (Result.isFailure(outcome) && activityId !== null) {
      throw new Error(`${spec.action} was refused after it had written, so none of it was kept.`);
    }
    return resultToWire(Result.map(outcome, (value) => ({ ...value, activityId })));
  };

export const changeMutation = <Args extends PropertyValidators, A extends object, E extends WireError>(
  spec: ChangeSpec<Args, A, E>,
) => ownerMutation({ args: spec.args, handler: changeHandler(spec) });

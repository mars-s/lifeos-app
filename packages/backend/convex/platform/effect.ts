import { Context, Effect, Result, Scheduler } from "effect";
import type { DefaultFunctionArgs, RegisteredMutation, RegisteredQuery } from "convex/server";
import type { ObjectType, PropertyValidators, Validator } from "convex/values";
import {
  internalAction as convexInternalAction,
  internalMutation as convexInternalMutation,
  internalQuery as convexInternalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import * as access from "./access";
import { startRecording, type Recorder as Recording } from "./activity";
import { changeAs, registerChange } from "./change";
import type { Actor } from "./tables";
import { fromNeverthrow, toNeverthrow } from "../../shared/effect/bridge";
import { resultToWire, valueOrThrow, type WireError } from "../../shared/effect/wire";
import type { SerialisedResult } from "../../shared/result";

export class Reads extends Context.Service<Reads, QueryCtx>()("lifeos/platform/Reads") {}

export class Writes extends Context.Service<Writes, MutationCtx>()("lifeos/platform/Writes") {}

export class Acts extends Context.Service<Acts, ActionCtx>()("lifeos/platform/Acts") {}

export class Recorder extends Context.Service<Recorder, Recording>()("lifeos/platform/Recorder") {}

export class CurrentActor extends Context.Service<CurrentActor, Actor>()("lifeos/platform/CurrentActor") {}

export class CurrentWorker extends Context.Service<CurrentWorker, Doc<"workers">>()("lifeos/platform/CurrentWorker") {}

export const reading = <A>(read: (ctx: QueryCtx) => Promise<A>) => Reads.use((ctx) => Effect.promise(() => read(ctx)));

export const writing = <A>(write: (ctx: MutationCtx) => Promise<A>) => Writes.use((ctx) => Effect.promise(() => write(ctx)));

export const acting = <A>(act: (ctx: ActionCtx) => Promise<A>) => Acts.use((ctx) => Effect.promise(() => act(ctx)));

export const recording = <A>(write: (record: Recording) => Promise<A>) =>
  Recorder.use((record) => Effect.promise(() => write(record)));

const insideConvex = new Scheduler.MixedScheduler("sync");

export const runAtEdge = async <A>(effect: Effect.Effect<A>) =>
  valueOrThrow(await Effect.runPromiseExit(effect, { scheduler: insideConvex }));

const runInAction = async <A>(effect: Effect.Effect<A>) => valueOrThrow(await Effect.runPromiseExit(effect));

const withReads =
  (ctx: QueryCtx) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(Reads, ctx));

const withWrites =
  (ctx: MutationCtx) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(Writes, ctx), Effect.provideService(Reads, ctx));

export type ChangeServices = Reads | Recorder | CurrentActor;

type Handler<Args extends PropertyValidators, A, R> = (args: ObjectType<Args>) => Effect.Effect<A, never, R>;

type Returns<A> = { returns?: Validator<A, "required", string> };

type AnyValidator = Validator<any, "required", any>;

const refusedAfterWrite = (action: string) => new Error(`${action} was refused after it had written, so none of it was kept.`);

export const runChange = <A extends object, E>(ctx: MutationCtx, actor: Actor, action: string, effect: Effect.Effect<A, E, ChangeServices>) =>
  Effect.gen(function* () {
    const record = startRecording(ctx, actor, action);
    const outcome = yield* Effect.result(
      effect.pipe(Effect.provideService(Recorder, record), Effect.provideService(CurrentActor, actor), withReads(ctx)),
    );
    const activityId = yield* Effect.promise(() => record.finish());
    if (Result.isFailure(outcome) && activityId !== null) return yield* Effect.die(refusedAfterWrite(action));
    return yield* Effect.fromResult(Result.map(outcome, (value) => ({ ...value, activityId })));
  });

export const legacyRead = <A, E extends WireError>(ctx: QueryCtx, effect: Effect.Effect<A, E, Reads>) =>
  runAtEdge(Effect.result(effect).pipe(withReads(ctx))).then(toNeverthrow);

export const legacyChange = <A, E extends WireError>(ctx: QueryCtx, record: Recording, effect: Effect.Effect<A, E, Reads | Recorder>) =>
  runAtEdge(Effect.result(effect).pipe(Effect.provideService(Recorder, record), withReads(ctx))).then(toNeverthrow);

export const readAsOwnerFx = <Args extends DefaultFunctionArgs, Output>(
  registered: RegisteredQuery<"public", Args, Promise<Output>>,
  args: Args,
) => reading((ctx) => access.readAsOwner(ctx, registered, args));

export const changeAsFx = <Args extends DefaultFunctionArgs, T, E>(
  actor: Actor,
  registered: RegisteredMutation<"public", Args, Promise<SerialisedResult<T, E>>>,
  args: Omit<Args, "agentRun">,
) => writing((ctx) => changeAs(ctx, actor, registered, args)).pipe(Effect.flatMap((result) => Effect.fromResult(fromNeverthrow(result))));

export const ownerQuery = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Reads> }) =>
  access.ownerQuery({ args: spec.args, handler: (ctx, args) => runAtEdge(spec.handler(args).pipe(withReads(ctx))) });

export const ownerMutation = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Reads | Writes | CurrentActor> }) =>
  access.ownerMutation({
    args: spec.args,
    handler: (ctx, args, actor) => runAtEdge(spec.handler(args).pipe(Effect.provideService(CurrentActor, actor), withWrites(ctx))),
  });

export const changeMutation = <Args extends PropertyValidators, A extends object, E extends WireError>(spec: {
  action: string;
  args: Args;
  handler: (args: ObjectType<Args>) => Effect.Effect<A, E, ChangeServices>;
}) => {
  const change = (ctx: MutationCtx, actor: Actor, args: ObjectType<Args>) =>
    runAtEdge(Effect.result(runChange(ctx, actor, spec.action, spec.handler(args))));
  const registered = access.ownerMutation({
    args: spec.args,
    handler: async (ctx, args, actor) => resultToWire(await change(ctx, actor, args)),
  });
  registerChange(registered, async (ctx, actor, args: ObjectType<Args>) => toNeverthrow(await change(ctx, actor, args)));
  return registered;
};

export const workerMutation = <Args extends PropertyValidators, A>(spec: {
  args: Args;
  handler: Handler<Args, A, Reads | Writes | CurrentWorker>;
}) =>
  access.workerMutation({
    args: spec.args,
    handler: (ctx, args, worker) => runAtEdge(spec.handler(args).pipe(Effect.provideService(CurrentWorker, worker), withWrites(ctx))),
  });

export const ownerAction = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Acts> }) =>
  access.ownerAction({ args: spec.args, handler: (ctx, args) => runInAction(spec.handler(args).pipe(Effect.provideService(Acts, ctx))) });

export const workerAction = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Acts | CurrentWorker> }) =>
  access.workerAction({
    args: spec.args,
    handler: (ctx, args, worker) =>
      runInAction(spec.handler(args).pipe(Effect.provideService(CurrentWorker, worker), Effect.provideService(Acts, ctx))),
  });

export const agentQuery = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Reads> }) =>
  access.agentQuery({ args: spec.args, handler: (ctx, args) => runAtEdge(spec.handler(args).pipe(withReads(ctx))) });

export const agentMutation = <Args extends PropertyValidators, A>(spec: {
  args: Args;
  handler: (
    args: ObjectType<Args>,
    run: Effect.Effect<access.AgentRunActor>,
    caller: access.AgentCaller,
  ) => Effect.Effect<A, never, Reads | Writes>;
}) =>
  access.agentMutation({
    args: spec.args,
    handler: (ctx, args, run, caller) => runAtEdge(spec.handler(args, Effect.promise(run), caller).pipe(withWrites(ctx))),
  });

export const internalQuery = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Reads> } & Returns<A>) => {
  const handler = (ctx: QueryCtx, args: ObjectType<Args>) => runAtEdge(spec.handler(args).pipe(withReads(ctx)));
  return spec.returns
    ? convexInternalQuery({ args: spec.args, returns: spec.returns as AnyValidator, handler })
    : convexInternalQuery({ args: spec.args, handler });
};

export const internalMutation = <Args extends PropertyValidators, A>(
  spec: { args: Args; handler: Handler<Args, A, Reads | Writes> } & Returns<A>,
) => {
  const handler = (ctx: MutationCtx, args: ObjectType<Args>) => runAtEdge(spec.handler(args).pipe(withWrites(ctx)));
  return spec.returns
    ? convexInternalMutation({ args: spec.args, returns: spec.returns as AnyValidator, handler })
    : convexInternalMutation({ args: spec.args, handler });
};

export const internalAction = <Args extends PropertyValidators, A>(spec: { args: Args; handler: Handler<Args, A, Acts> } & Returns<A>) => {
  const handler = (ctx: ActionCtx, args: ObjectType<Args>) => runInAction(spec.handler(args).pipe(Effect.provideService(Acts, ctx)));
  return spec.returns
    ? convexInternalAction({ args: spec.args, returns: spec.returns as AnyValidator, handler })
    : convexInternalAction({ args: spec.args, handler });
};

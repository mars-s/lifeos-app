import type { DefaultFunctionArgs, RegisteredMutation } from "convex/server";
import type { PropertyValidators, ObjectType } from "convex/values";
import type { Result } from "neverthrow";
import type { MutationCtx } from "../_generated/server";
import { serialise, type SerialisedResult } from "../../shared/result";
import { ownerMutation } from "./access";
import { startRecording, type Recorder } from "./activity";
import type { Actor } from "./tables";

type ChangeSpec<Args extends PropertyValidators, T extends object, E> = {
  action: string;
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, record: Recorder) => Promise<Result<T, E>>;
};

const applyChange = async <Args extends PropertyValidators, T extends object, E>(
  ctx: MutationCtx,
  actor: Actor,
  spec: ChangeSpec<Args, T, E>,
  args: ObjectType<Args>,
) => {
  const record = startRecording(ctx, actor, spec.action);
  const result = await spec.handler(ctx, args, record);
  const activityId = await record.finish();
  if (result.isErr() && activityId !== null) throw new Error(`${spec.action} was refused after it had written, so none of it was kept.`);
  return result.map((value) => ({ ...value, activityId }));
};

type ChangeRun<Args> = (ctx: MutationCtx, actor: Actor, args: Args) => Promise<Result<unknown, unknown>>;

const changes = new WeakMap<object, ChangeRun<never>>();

export const registerChange = <Args>(registered: object, run: ChangeRun<Args>) => {
  changes.set(registered, run as ChangeRun<never>);
};

export const changeMutation = <Args extends PropertyValidators, T extends object, E>(spec: ChangeSpec<Args, T, E>) => {
  const registered = ownerMutation({
    args: spec.args,
    handler: async (ctx, args, actor) => serialise(await applyChange(ctx, actor, spec, args)),
  });
  registerChange(registered, (ctx, actor, args: ObjectType<Args>) => applyChange(ctx, actor, spec, args));
  return registered;
};

export const changeAs = async <Args extends DefaultFunctionArgs, T, E>(
  ctx: MutationCtx,
  actor: Actor,
  registered: RegisteredMutation<"public", Args, Promise<SerialisedResult<T, E>>>,
  args: Omit<Args, "agentRun">,
) => {
  const run = changes.get(registered);
  if (!run) throw new Error("changeAs needs a mutation built with changeMutation.");
  return (await run(ctx, actor, args as never)) as Result<T, E>;
};

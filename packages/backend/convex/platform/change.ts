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
  const activityId = record.finish();
  return result.map((value) => ({ ...value, activityId }));
};

const changes = new WeakMap<object, ChangeSpec<PropertyValidators, object, unknown>>();

export const changeMutation = <Args extends PropertyValidators, T extends object, E>(spec: ChangeSpec<Args, T, E>) => {
  const registered = ownerMutation({
    args: spec.args,
    handler: async (ctx, args, actor) => serialise(await applyChange(ctx, actor, spec, args)),
  });
  changes.set(registered, spec as unknown as ChangeSpec<PropertyValidators, object, unknown>);
  return registered;
};

export const changeAs = async <Args extends DefaultFunctionArgs, T, E>(
  ctx: MutationCtx,
  actor: Actor,
  registered: RegisteredMutation<"public", Args, Promise<SerialisedResult<T, E>>>,
  args: Omit<Args, "agentRun">,
) => {
  const spec = changes.get(registered);
  if (!spec) throw new Error("changeAs needs a mutation built with changeMutation.");
  return (await applyChange(ctx, actor, spec, args)) as Result<T, E>;
};

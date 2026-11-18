import type { PropertyValidators, ObjectType } from "convex/values";
import type { Result } from "neverthrow";
import type { MutationCtx } from "../_generated/server";
import { serialise } from "../../shared/result";
import { ownerMutation } from "./access";
import { startRecording, type Recorder } from "./activity";

export const changeMutation = <Args extends PropertyValidators, T extends object, E>(spec: {
  action: string;
  args: Args;
  handler: (ctx: MutationCtx, args: ObjectType<Args>, record: Recorder) => Promise<Result<T, E>>;
}) =>
  ownerMutation({
    args: spec.args,
    handler: async (ctx, args, actor) => {
      const record = startRecording(ctx, actor, spec.action);
      const result = await spec.handler(ctx, args, record);
      const activityId = await record.finish();
      return serialise(result.map((value) => ({ ...value, activityId })));
    },
  });

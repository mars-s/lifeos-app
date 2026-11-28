import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Backend } from "./backend";

const taskId = "task1" as Id<"tasks">;

const rename = (title: string) => Backend.use((backend) => backend.change(api.planner.tasks.rename, { taskId, title }));

describe("the client Backend", () => {
  it.effect("puts a refusal in the error channel as plain wire data, and a success in the value", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const answered = Backend.layerTest((name, args) => {
        asked.push(name);
        return args.title === "" ? { ok: false, error: { kind: "empty_title" } } : { ok: true, value: { changed: true, activityId: null } };
      });
      expect(yield* rename("Draft intro").pipe(Effect.provide(answered))).toStrictEqual({ changed: true, activityId: null });
      expect(yield* Effect.flip(rename("")).pipe(Effect.provide(answered))).toStrictEqual({ kind: "empty_title" });
      expect(asked).toStrictEqual(["planner/tasks:rename", "planner/tasks:rename"]);
    }),
  );

  it.effect("sends through the app's client on the live Layer", () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const live = Backend.layer(async (_mutation, args) => {
        sent.push(args);
        return { ok: true, value: { changed: false, activityId: null } };
      });
      expect(yield* rename("Same").pipe(Effect.provide(live))).toStrictEqual({ changed: false, activityId: null });
      expect(sent).toStrictEqual([{ taskId, title: "Same" }]);
    }),
  );
});

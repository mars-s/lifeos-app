import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type { Id } from "../../../convex/_generated/dataModel";
import { Backend, renameTaskAtom, selectedAtom, selectedCountAtom, toggleSelectedAtom } from "./atoms";

const taskId = "task1" as Id<"tasks">;

describe("atoms", () => {
  it("derive from writable state inside one registry", () => {
    const registry = AtomRegistry.make();
    registry.set(toggleSelectedAtom, "a");
    registry.set(toggleSelectedAtom, "b");
    registry.set(toggleSelectedAtom, "a");
    expect([...registry.get(selectedAtom)]).toEqual(["b"]);
    expect(registry.get(selectedCountAtom)).toBe(1);
  });

  it.live("run a change through the Backend service and keep a refusal typed", () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const runtime = Atom.runtime(
        Backend.layer(async (_mutation, args) => {
          sent.push(args);
          return args.title === "" ? { ok: false, error: { kind: "empty_title" } } : { ok: true, value: { changed: true, activityId: null } };
        }),
      );
      const rename = renameTaskAtom(runtime);
      const registry = AtomRegistry.make();
      const release = registry.mount(rename);
      registry.set(rename, { taskId, title: "Draft intro" });
      const saved = yield* AtomRegistry.getResult(registry, rename);
      expect(saved).toMatchObject({ changed: true });
      registry.set(rename, { taskId, title: "" });
      yield* Effect.yieldNow;
      const refused = yield* Effect.flip(AtomRegistry.getResult(registry, rename, { suspendOnWaiting: true }));
      expect(refused).toStrictEqual({ kind: "empty_title" });
      expect(AsyncResult.isFailure(registry.get(rename))).toBe(true);
      expect(sent).toHaveLength(2);
      release();
    }),
  );
});

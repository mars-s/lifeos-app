import { Cause, Layer, Option } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, test } from "vitest";
import { api } from "@lifeos/backend/api";
import { Backend } from "@lifeos/backend/client/backend";
import { atomRuntime } from "./runtime";

const scripted = Layer.mergeAll(
  Backend.layerTest((_name, args) => (args.title === "" ? { ok: false, error: { kind: "empty_title" } } : { ok: true, value: { changed: true, activityId: null } })),
  KeyValueStore.layerMemory,
);

const renameAtom = atomRuntime.fn<{ title: string }>()(({ title }) =>
  Backend.use((backend) => backend.change(api.planner.tasks.rename, { taskId: "task1" as never, title })),
);

const settle = <A, E>(registry: AtomRegistry.AtomRegistry, atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, { title: string }>, title: string) =>
  new Promise<AsyncResult.AsyncResult<A, E>>((resolve) => {
    const stop = registry.subscribe(atom, (result) => {
      if (result.waiting) return;
      stop();
      resolve(result);
    });
    registry.set(atom, { title });
  });

test("a write reaches subscribers before set returns", () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(0).pipe(Atom.keepAlive);
  const heard: number[] = [];
  registry.subscribe(count, (value) => heard.push(value));
  registry.set(count, 1);
  expect(heard).toStrictEqual([1]);
});

test("a mutation on the app runtime reads its refusal as plain wire data when the Backend Layer is scripted", async () => {
  const registry = AtomRegistry.make({ initialValues: [[atomRuntime.layer, scripted]] });
  const refused = await settle(registry, renameAtom, "");
  expect(AsyncResult.isFailure(refused) && Option.getOrUndefined(Cause.findErrorOption(refused.cause))).toStrictEqual({ kind: "empty_title" });
  const saved = await settle(registry, renameAtom, "Draft intro");
  expect(AsyncResult.getOrElse(saved, () => null)).toStrictEqual({ changed: true, activityId: null });
});

import { Atom } from "effect/reactivity";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Backend } from "../../client/backend";

export type Face = "list" | "timeline";

export const faceAtom = Atom.make<Face>("list").pipe(Atom.keepAlive);

export const selectedAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);

export const selectedCountAtom = Atom.make((get) => get(selectedAtom).size);

export const toggleSelectedAtom = Atom.writable(
  (get) => get(selectedAtom),
  (ctx, key: string) => {
    const next = new Set(ctx.get(selectedAtom));
    if (!next.delete(key)) next.add(key);
    ctx.set(selectedAtom, next);
  },
);

export const renameTaskAtom = (runtime: Atom.AtomRuntime<Backend>) =>
  runtime.fn<{ taskId: Id<"tasks">; title: string }>()((args) =>
    Backend.use((backend) => backend.change(api.planner.tasks.rename, args)),
  );

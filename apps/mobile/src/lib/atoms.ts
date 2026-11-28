import { scheduleTask } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import { PrefsStore } from "@/lib/runtime";

export const registry = AtomRegistry.make({ scheduleTask, defaultIdleTTL: 400 });

export const prefsRuntime = Atom.runtime(PrefsStore);

import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { router } from "expo-router";
import { api } from "@lifeos/backend/api";
import { taskActions, quoted } from "@lifeos/backend/client/task-actions";
import { completingTasks } from "@lifeos/backend/client/updaters";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";
import { Alert } from "react-native";
import { registry } from "@/lib/atoms";
import { change } from "@/lib/change";
import { convex } from "@/lib/convex";
import { haptic } from "@/lib/haptics";
import { LINGER_MS } from "@/lib/motion";
import { projectHref } from "@/lib/route";
import { useView } from "@/lib/views";

const PREWARM_MS = 8000;
const seeds = new Map<string, PlannerTask>();

export const rememberTask = (task: PlannerTask) => {
  seeds.set(task._id, task);
  const stop = convex?.watchQuery(api.planner.tasks.row, { taskId: task._id }).onUpdate(() => undefined);
  if (stop) setTimeout(stop, PREWARM_MS);
};

export const isUnsaved = (id: string) => id.startsWith("optimistic:");

export const useTask = (taskId: Id<"tasks">) => {
  const live = useView(api.planner.tasks.row, isUnsaved(taskId) ? "skip" : { taskId });
  return live === undefined ? seeds.get(taskId) : (live ?? undefined);
};

const lingeringAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive);
const pending = new Map<string, ReturnType<typeof setTimeout>>();

const setLingering = (id: string, on: boolean) => {
  const next = new Set(registry.get(lingeringAtom));
  if (on) next.add(id);
  else next.delete(id);
  registry.set(lingeringAtom, next);
};

export const useLingering = (taskId: string) => useAtomValue(lingeringAtom, (lingering) => lingering.has(taskId));

export const completeSoon = (task: PlannerTask) => {
  const taskId = task._id;
  if (pending.has(taskId) || isUnsaved(taskId)) return;
  haptic("complete");
  setLingering(taskId, true);
  pending.set(
    taskId,
    setTimeout(() => {
      pending.delete(taskId);
      void change({
        title: `Completed ${quoted(task.title)}`,
        mutation: api.planner.tasks.complete,
        args: { taskId },
        ...completingTasks([taskId]),
        onUndo: () => setLingering(taskId, false),
      });
      setTimeout(() => setLingering(taskId, false), LINGER_MS);
    }, LINGER_MS),
  );
};

export const keepOpen = (task: PlannerTask) => {
  clearTimeout(pending.get(task._id));
  pending.delete(task._id);
  haptic("toggle");
  setLingering(task._id, false);
};

const confirm = ({ title, body, action, onConfirm }: { title: string; body: string; action: string; onConfirm: () => void }) =>
  Alert.alert(title, body, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: onConfirm },
  ]);

export const actionsFor = (task: PlannerTask, today: string) => taskActions(change, task, today, confirm);

export const turnIntoProject = (task: PlannerTask, today: string) => {
  if (isUnsaved(task._id)) return;
  haptic("drop");
  router.dismissAll();
  void actionsFor(task, today).convertToProject((projectId) => router.push(projectHref(projectId)));
};

export const duplicateTask = (task: PlannerTask, today: string) => {
  if (isUnsaved(task._id)) return;
  haptic("drop");
  router.back();
  void actionsFor(task, today).duplicate();
};

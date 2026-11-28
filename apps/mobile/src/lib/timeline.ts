import type { FunctionReturnType } from "convex/server";
import { SQLiteStorage } from "expo-sqlite/kv-store";
import { Result } from "neverthrow";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { inkLoad } from "@lifeos/backend/timeline";
import type { OptimisticLocalStore } from "convex/browser";
import { change } from "@/lib/change";
import { haptic } from "@/lib/haptics";
import { useView, valueOf } from "@/lib/views";

export type TimelineView = Extract<FunctionReturnType<typeof api.planner.timeline.days>, { ok: true }>["value"];
export type TimelineDay = TimelineView["days"][number];
export type TimelineBlock = TimelineDay["blocks"][number];
export type TimelinePrediction = TimelineDay["predictions"][number];
export type Face = "list" | "timeline";

const FACE_KEY = "today-face";
const NOW_STEP_MS = 60_000;
const prefs = new SQLiteStorage("lifeos-prefs");
const faceListeners = new Set<() => void>();
let face: Face = Result.fromThrowable(() => prefs.getItemSync(FACE_KEY))().unwrapOr(null) === "timeline" ? "timeline" : "list";

export const setFace = (next: Face) => {
  face = next;
  prefs.setItemAsync(FACE_KEY, next).catch(() => undefined);
  faceListeners.forEach((listener) => listener());
};

const subscribeFace = (listener: () => void) => {
  faceListeners.add(listener);
  return () => void faceListeners.delete(listener);
};

export const useFace = () => useSyncExternalStore(subscribeFace, () => face, () => face);

const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, NOW_STEP_MS / 4);
  const focus = AppState.addEventListener("change", onChange);
  return () => {
    clearInterval(timer);
    focus.remove();
  };
};

const readMinute = () => Math.floor(Date.now() / NOW_STEP_MS) * NOW_STEP_MS;

export const useMinute = () => useSyncExternalStore(subscribeMinute, readMinute, readMinute);

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const PREDICT_STEP_MS = 5 * NOW_STEP_MS;

export const useTimeline = (from: string, days: number, now: number) =>
  valueOf(useView(api.planner.timeline.days, { from, days, timeZone: timeZone(), now: Math.floor(now / PREDICT_STEP_MS) * PREDICT_STEP_MS }));

const patchDays = (edit: (day: TimelineDay) => TimelineDay) => (store: OptimisticLocalStore) => {
  for (const { args, value } of store.getAllQueries(api.planner.timeline.days)) {
    if (!value?.ok) continue;
    const days = value.value.days.map((day) => {
      const next = edit(day);
      return next === day ? day : { ...next, load: inkLoad(next.blocks, next.predictions) };
    });
    store.setQuery(api.planner.timeline.days, args, { ok: true, value: { ...value.value, days } });
  }
};

let optimistic = 0;

const blockFor = (prediction: TimelinePrediction, start: number) => {
  optimistic += 1;
  return {
    _id: `optimistic:block:${optimistic}` as Id<"workBlocks">,
    taskId: prediction.taskId,
    start,
    minutes: prediction.minutes,
    done: false,
    title: prediction.title,
    area: prediction.area,
    trip: prediction.trip,
  } satisfies TimelineBlock;
};

const keptOn = (date: string, kept: readonly { prediction: TimelinePrediction; block: TimelineBlock }[]) =>
  patchDays((day) => {
    if (day.date !== date) return day;
    const ids = new Set(kept.map((each) => each.prediction.taskId));
    return { ...day, predictions: day.predictions.filter((prediction) => !ids.has(prediction.taskId)), blocks: [...day.blocks, ...kept.map((each) => each.block)] };
  });

const unkeptOn = (date: string, kept: readonly { prediction: TimelinePrediction; block: TimelineBlock }[]) =>
  patchDays((day) => {
    if (day.date !== date) return day;
    const ids = new Set(kept.map((each) => each.block._id));
    const back = kept.map((each) => each.prediction).filter((prediction) => !day.predictions.some((other) => other.taskId === prediction.taskId));
    return { ...day, blocks: day.blocks.filter((block) => !ids.has(block._id)), predictions: [...day.predictions, ...back].toSorted((a, b) => a.start - b.start) };
  });

const clock = (at: number) => new Date(at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

export const keepPrediction = (date: string, prediction: TimelinePrediction, start = prediction.start) => {
  haptic("drop");
  const kept = [{ prediction, block: blockFor(prediction, start) }];
  void change({
    title: `Kept ${prediction.title} at ${clock(start)}`,
    mutation: api.planner.workBlocks.create,
    args: { taskId: prediction.taskId, start, minutes: prediction.minutes, timeZone: timeZone() },
    apply: keptOn(date, kept),
    revert: unkeptOn(date, kept),
  });
};

export const keepAll = (date: string, predictions: readonly TimelinePrediction[]) => {
  if (predictions.length === 0) return;
  haptic("drop");
  const kept = predictions.map((prediction) => ({ prediction, block: blockFor(prediction, prediction.start) }));
  void change({
    title: `Kept ${kept.length} prediction${kept.length === 1 ? "" : "s"}`,
    mutation: api.planner.workBlocks.spread,
    args: { timeZone: timeZone(), blocks: predictions.map(({ taskId, start, minutes }) => ({ taskId, start, minutes })) },
    apply: keptOn(date, kept),
    revert: unkeptOn(date, kept),
  });
};

const doneOn = (taskId: Id<"tasks">, done: boolean) =>
  patchDays((day) => (day.blocks.some((block) => block.taskId === taskId) ? { ...day, blocks: day.blocks.map((block) => (block.taskId === taskId ? { ...block, done } : block)) } : day));

export const tickBlock = (block: TimelineBlock) => {
  haptic(block.done ? "toggle" : "complete");
  void (block.done
    ? change({ title: `Reopened ${block.title}`, mutation: api.planner.tasks.uncomplete, args: { taskId: block.taskId }, apply: doneOn(block.taskId, false), revert: doneOn(block.taskId, true) })
    : change({ title: `Completed ${block.title}`, mutation: api.planner.tasks.complete, args: { taskId: block.taskId }, apply: doneOn(block.taskId, true), revert: doneOn(block.taskId, false) }));
};


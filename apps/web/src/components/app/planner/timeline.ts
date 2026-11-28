"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import { dayShareCap } from "@lifeos/backend/plan";
import type { Span } from "@lifeos/backend/spread";
import { isPredictedDay, predictDay, type Fit } from "@lifeos/backend/timeline";
import type { PlannerTask } from "@lifeos/backend/types";
import type { FunctionReturnType } from "convex/server";
import type { EnergyCurve, EnergyMode } from "@/components/lifeos/energy-curve";
import type { TimeboxTrip } from "@/components/lifeos/timebox";
import { minuteOfDay, startOfLocalDay } from "../dates";
import { isDraftTask } from "../drafts";
import { useQuietView, valueOf } from "../hooks";
import { localZone, type PlannerModel } from "./model";

type EnergyDays = NonNullable<Extract<FunctionReturnType<typeof api.health.energy.days>, { ok: true }>["value"]>;
export type EnergyDay = EnergyDays[number];

export type Pick = { task: PlannerTask; start: number; minutes: number; guess: boolean; fit: Fit | null; trip: TimeboxTrip | null };
export type DayPrediction = { date: IsoDate; picks: Pick[]; unfit: PlannerTask[] };

const NO_TRIPS: ReadonlyMap<string, TimeboxTrip> = new Map();
const MAX_DAYS = 14;

export const useTrips = (dates: readonly IsoDate[]) => {
  const first = dates[0];
  const view = valueOf(
    useQuietView(
      api.planner.timeline.days,
      first ? { from: first, days: Math.min(MAX_DAYS, dates.length), timeZone: localZone(), now: startOfLocalDay(first) } : "skip",
    ),
  );
  return useMemo(() => {
    if (!view) return NO_TRIPS;
    const trips = new Map<string, TimeboxTrip>();
    for (const day of view.days) {
      for (const block of day.blocks) if (block.trip) trips.set(block.taskId, block.trip);
      for (const prediction of day.predictions) if (prediction.trip) trips.set(prediction.taskId, prediction.trip);
    }
    return trips;
  }, [view]);
};

const NO_ENERGY: readonly EnergyDay[] = [];

export const useEnergy = (dates: readonly IsoDate[], today: IsoDate) => {
  const from = dates[0];
  const to = dates.at(-1);
  const days = valueOf(useQuietView(api.health.energy.days, from && to ? { from, to, today, timeZone: localZone() } : "skip")) ?? NO_ENERGY;
  return useMemo(() => new Map(days.map((day) => [day.date as string, day])), [days]);
};

export const curveOf = (day: EnergyDay | undefined) => (day && (day.kind === "solid" || day.kind === "usual") ? day : null);

export const energyModeOf = (date: IsoDate, today: IsoDate, day: EnergyDay | undefined) => {
  const mode: EnergyMode = date < today ? "past" : date === today && day?.kind === "solid" ? "today" : "usual";
  return mode;
};

export const railCurveOf = (day: EnergyDay | undefined) => {
  const curve = curveOf(day);
  return curve ? ({ points: curve.points, peak: curve.peak, dip: curve.dip, bedtime: curve.bedtime } satisfies EnergyCurve) : null;
};

export const predictDays = ({
  model,
  today,
  now,
  busyOf,
  trips,
  energy,
}: {
  model: PlannerModel;
  today: IsoDate;
  now: number;
  busyOf: (date: IsoDate, index: number) => readonly Span[];
  trips: ReadonlyMap<string, TimeboxTrip>;
  energy: ReadonlyMap<string, EnergyDay>;
}) => {
  const tomorrow = addDays(today, 1);
  const { startMinute, endMinute } = model.workingHours;
  return model.days.flatMap((day, index) => {
    if (!isPredictedDay(day.date, today, tomorrow)) return [];
    const window = { start: day.date === today ? Math.max(startMinute, minuteOfDay(now)) : startMinute, end: endMinute };
    const tasks = day.tasks.filter((task) => task.status.kind === "open" && !isDraftTask(task._id) && !day.boxed.has(task._id));
    const curve = curveOf(energy.get(day.date));
    const { placed, unfit } = predictDay({
      tasks,
      boxed: day.boxed,
      guessOf: (taskId) => model.guesses.get(taskId),
      travelOf: (taskId) => trips.get(taskId)?.minutes ?? 0,
      busy: [...day.busy, ...busyOf(day.date, index)],
      window,
      cap: dayShareCap(day.goal),
      energy: curve,
    });
    const byId = new Map(tasks.map((task) => [task._id as string, task]));
    const picks = placed.flatMap((pick) => {
      const task = byId.get(pick.taskId);
      return task ? [{ task, start: pick.start, minutes: pick.minutes, guess: pick.guess, fit: pick.fit ?? null, trip: trips.get(task._id) ?? null } satisfies Pick] : [];
    });
    return [{ date: day.date, picks, unfit } satisfies DayPrediction];
  });
};

"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { SleepNight } from "@lifeos/backend/types";
import { formatMinutes } from "@/components/lifeos/format";
import type { SleepEdge, TimeboxSleep } from "@/components/lifeos/timebox";
import { clockTime, minuteOfDay, startOfLocalDay } from "../dates";
import { useQuietView, valueOf } from "../hooks";
import { localZone } from "./model";

const DAY_MINUTES = 24 * 60;
const NO_NIGHTS: readonly SleepNight[] = [];

const bedtimeName = { oura: "Oura's bedtime", usual: "Your usual bedtime" } as const;

const edgesOf = (night: SleepNight) => {
  const bed = clockTime(night.start);
  const wake = clockTime(night.end);
  if (night.kind === "slept") {
    const top: SleepEdge = { label: "Asleep", short: "Bed", time: bed };
    const bottom: SleepEdge = { label: "Woke", short: "Woke", time: wake };
    return { top, bottom };
  }
  const top: SleepEdge = { label: bedtimeName[night.bedtime], short: "Bed", time: bed };
  const bottom: SleepEdge = { label: "Your usual wake", short: "Wake", time: wake };
  return { top, bottom };
};

const titleOf = (night: SleepNight) => {
  const span = `${clockTime(night.start)} to ${clockTime(night.end)}`;
  if (night.kind === "slept") {
    const scores = [
      night.asleepMinutes === null ? null : `${formatMinutes(night.asleepMinutes)} asleep`,
      night.sleepScore === null ? null : `sleep score ${night.sleepScore}`,
      night.readinessScore === null ? null : `readiness ${night.readinessScore}`,
    ].filter(Boolean);
    return `Sleep, from Oura: ${span}${scores.length > 0 ? `. ${scores.join(", ")}` : ""}.`;
  }
  const bedtime =
    night.bedtime === "oura" && night.latestBedtime !== null
      ? `Oura's bedtime is ${clockTime(night.start)} to ${clockTime(night.latestBedtime)}`
      : `Your usual bedtime is ${clockTime(night.start)}`;
  return `Sleep Window: ${span}. ${bedtime}. Wake is your usual wake over your last 14 nights.`;
};

export const sleepBands = (nights: readonly SleepNight[], dates: readonly IsoDate[]) =>
  dates.flatMap((date, day) => {
    const dayStart = startOfLocalDay(date);
    const dayEnd = startOfLocalDay(addDays(date, 1));
    return nights.flatMap((night) => {
      if (night.end <= dayStart || night.start >= dayEnd) return [];
      const opens = night.start >= dayStart;
      const closes = night.end <= dayEnd;
      const start = opens ? minuteOfDay(night.start) : 0;
      const end = closes ? minuteOfDay(night.end) || DAY_MINUTES : DAY_MINUTES;
      const { top, bottom } = edgesOf(night);
      const latest = night.kind === "planned" && opens ? night.latestBedtime : null;
      const windowEnd = latest === null ? null : latest >= dayEnd ? end : Math.min(minuteOfDay(latest), end);
      const band: TimeboxSleep = {
        id: `sleep:${night.wakeDate}:${date}`,
        day,
        start,
        end,
        kind: night.kind,
        windowEnd: windowEnd !== null && windowEnd > start ? windowEnd : null,
        top: opens ? top : null,
        bottom: closes ? bottom : null,
        title: titleOf(night),
      };
      return end > start ? [band] : [];
    });
  });

export const useSleep = (dates: readonly IsoDate[], today: IsoDate) => {
  const from = dates[0] ?? today;
  const nights =
    valueOf(useQuietView(api.health.sleep.nights, { from, days: dates.length, today, timeZone: localZone() })) ?? NO_NIGHTS;
  return useMemo(() => sleepBands(nights, dates), [nights, dates]);
};

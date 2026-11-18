"use client";

import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import { addDays, type IsoDate } from "@lifeos/backend/date";
import type { CommitmentRow } from "@lifeos/backend/types";
import type { CommitmentItem } from "@/components/lifeos/commitments";
import { formatMinutes } from "@/components/lifeos/format";
import { clockTime, endOfLocalDay, localDate, startOfLocalDay } from "./dates";
import { useQuietView, valueOf } from "./hooks";

const MAX_DAYS_SHOWN = 62;

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const datesCovered = (row: CommitmentRow) => {
  const first = localDate(row.start) as IsoDate;
  const last = localDate(Math.max(row.start, row.end - 1)) as IsoDate;
  const dates: IsoDate[] = [];
  for (let date = first; date <= last && dates.length < MAX_DAYS_SHOWN; date = addDays(date, 1)) dates.push(date);
  return dates;
};

const itemFor = (row: CommitmentRow, date: IsoDate) =>
  ({
    key: `${row._id}:${date}`,
    title: row.title,
    time: row.allDay || row.start < startOfLocalDay(date) ? null : clockTime(row.start),
    colour: row.calendar.colour,
    quiet: row.availability === "free" || row.response === "declined",
  }) satisfies CommitmentItem;

const byAllDayThenStart = (a: CommitmentItem & { start: number }, b: CommitmentItem & { start: number }) =>
  Number(a.time !== null) - Number(b.time !== null) || a.start - b.start;

export const useCommitmentsByDay = (from: IsoDate, to: IsoDate) => {
  const response = useQuietView(api.calendar.commitments.range, { from: startOfLocalDay(from), to: endOfLocalDay(to) + 1 });
  const rows = valueOf(response);
  return useMemo(() => {
    const days = new Map<IsoDate, (CommitmentItem & { start: number })[]>();
    for (const row of rows ?? []) {
      for (const date of datesCovered(row)) {
        if (date < from || date > to) continue;
        days.set(date, [...(days.get(date) ?? []), { ...itemFor(row, date), start: row.start }]);
      }
    }
    return new Map([...days].map(([date, items]) => [date, items.toSorted(byAllDayThenStart) as CommitmentItem[]]));
  }, [rows, from, to]);
};

export const useFreeToday = (today: IsoDate) => {
  const response = useQuietView(api.calendar.capacity.days, { from: today, days: 1, timeZone: timeZone() });
  const day = valueOf(response)?.days[0];
  return day ? formatMinutes(Math.max(0, day.freeMinutes)) : null;
};

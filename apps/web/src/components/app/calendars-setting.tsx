"use client";

import { CalendarCheck } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@lifeos/backend/api";
import type { CalendarsView } from "@lifeos/backend/types";
import { Popover } from "@/components/ui/popover-panel";
import { Switch } from "@/components/ui/choice-controls";
import { formatClock } from "@/components/lifeos/format";
import { useChange } from "./changes";
import { timeAgo } from "./dates";
import { useNow, useQuietView } from "./hooks";

type CalendarRow = CalendarsView["calendars"][number];

const setIncluded = (calendar: CalendarRow, included: boolean) => (store: OptimisticLocalStore) => {
  const view = store.getQuery(api.calendar.calendars.list, {});
  if (view) {
    store.setQuery(api.calendar.calendars.list, {}, {
      ...view,
      calendars: view.calendars.map((each) => (each._id === calendar._id ? { ...each, included } : each)),
    });
  }
  if (included) return;
  for (const { args, value } of store.getAllQueries(api.calendar.commitments.range)) {
    if (!value?.ok) continue;
    store.setQuery(api.calendar.commitments.range, args, {
      ok: true,
      value: value.value.filter((row) => row.calendarId !== calendar.calendarId),
    });
  }
};

const groupBySource = (calendars: readonly CalendarRow[]) => {
  const groups = new Map<string, CalendarRow[]>();
  for (const calendar of calendars) groups.set(calendar.source, [...(groups.get(calendar.source) ?? []), calendar]);
  return [...groups];
};

const SyncLine = ({ syncedAt }: { syncedAt: number | null }) => {
  const now = useNow();
  return (
    <p className="px-2.5 pb-2 text-small text-pretty text-muted-foreground">
      {syncedAt === null
        ? "Open LifeOS on your Mac and allow calendar access to bring in Apple Calendar."
        : `Read from Apple Calendar on your Mac ${now === null ? "" : timeAgo(syncedAt, Math.max(now, syncedAt))}. Calendars that are on count against your free time.`}
    </p>
  );
};

export const CalendarsButton = () => {
  const view = useQuietView(api.calendar.calendars.list, {});
  const hours = useQuietView(api.calendar.workingHours.get, {});
  const change = useChange();
  const toggle = (calendar: CalendarRow, included: boolean) =>
    void change({
      title: included ? `Showing ${calendar.title}` : `Hid ${calendar.title}`,
      mutation: api.calendar.calendars.setIncluded,
      args: { calendarId: calendar._id, included },
      apply: setIncluded(calendar, included),
      revert: setIncluded(calendar, !included),
      slot: `calendar:${calendar._id}`,
    });
  return (
    <Popover
      side="top"
      align="end"
      title="Calendars"
      className="w-[18.5rem] p-1.5"
      trigger={
        <button
          type="button"
          aria-label="Calendars"
          title="Calendars"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.94] aria-expanded:bg-foreground/[0.06] aria-expanded:text-foreground"
        >
          <CalendarCheck weight="fill" className="size-4" aria-hidden="true" />
        </button>
      }
    >
      <SyncLine syncedAt={view?.syncedAt ?? null} />
      <div className="max-h-80 overflow-y-auto overscroll-contain">
        {groupBySource(view?.calendars ?? []).map(([source, calendars]) => (
          <section key={source} aria-label={source} className="pb-1.5">
            <h3 className="px-2.5 pt-1 pb-0.5 text-micro text-faint-foreground">{source}</h3>
            <ul>
              {calendars.map((calendar) => (
                <li key={calendar._id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: calendar.colour }} />
                  <span className="min-w-0 flex-1 truncate text-small">{calendar.title}</span>
                  <Switch
                    aria-label={`Count ${calendar.title}`}
                    checked={calendar.included}
                    onCheckedChange={(included) => toggle(calendar, included)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {hours && (
        <p className="px-2.5 pt-1 pb-1.5 text-small text-muted-foreground">
          Working hours{" "}
          <span className="font-mono text-foreground tabular-nums">
            {formatClock(hours.startMinute)} to {formatClock(hours.endMinute)}
          </span>
        </p>
      )}
    </Popover>
  );
};

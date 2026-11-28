import { v } from "convex/values";
import { Effect } from "effect";
import { changeMutation, ownerQuery, reading, recording } from "../platform/effect";
import { CalendarNotFound } from "./errors";

const CALENDAR_LIMIT = 200;

export const list = ownerQuery({
  args: {},
  handler: Effect.fn("calendars.list")(function* () {
    const calendars = yield* reading((ctx) => ctx.db.query("calendars").take(CALENDAR_LIMIT));
    const sync = yield* reading((ctx) => ctx.db.query("calendarSync").first());
    return {
      calendars: calendars
        .toSorted((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title))
        .map(({ _id, calendarId, title, colour, source, kind, included }) => ({ _id, calendarId, title, colour, source, kind, included })),
      syncedAt: sync?.syncedAt ?? null,
    };
  }),
});

export const setIncluded = changeMutation({
  action: "calendar.include",
  args: { calendarId: v.id("calendars"), included: v.boolean() },
  handler: Effect.fn("calendars.setIncluded")(function* ({ calendarId, included }) {
    const calendar = yield* reading((ctx) => ctx.db.get("calendars", calendarId));
    if (!calendar) return yield* new CalendarNotFound();
    yield* recording((record) => record.patch("calendars", calendarId, { included }));
    return { calendarId };
  }),
});

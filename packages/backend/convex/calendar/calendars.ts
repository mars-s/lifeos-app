import { v } from "convex/values";
import { err, ok } from "neverthrow";
import { ownerQuery } from "../platform/access";
import { changeMutation } from "../platform/change";
import type { CalendarError } from "./model";

const CALENDAR_LIMIT = 200;

export const list = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const calendars = await ctx.db.query("calendars").take(CALENDAR_LIMIT);
    const sync = await ctx.db.query("calendarSync").first();
    return {
      calendars: calendars
        .toSorted((a, b) => a.source.localeCompare(b.source) || a.title.localeCompare(b.title))
        .map(({ _id, title, colour, source, kind, included }) => ({ _id, title, colour, source, kind, included })),
      syncedAt: sync?.syncedAt ?? null,
    };
  },
});

export const setIncluded = changeMutation({
  action: "calendar.include",
  args: { calendarId: v.id("calendars"), included: v.boolean() },
  handler: async (ctx, { calendarId, included }, record) => {
    const calendar = await ctx.db.get("calendars", calendarId);
    if (!calendar) return err<{ calendarId: typeof calendarId }, CalendarError>({ kind: "not_found" });
    await record.patch("calendars", calendarId, { included });
    return ok<{ calendarId: typeof calendarId }, CalendarError>({ calendarId });
  },
});

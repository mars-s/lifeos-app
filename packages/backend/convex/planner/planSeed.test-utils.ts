import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { zonedMoment } from "../calendar/model";
import type { Availability, Response } from "../calendar/tables";
import { addDays, type IsoDate } from "../../shared/date";

const CALENDARS = [
  { calendarId: "seed-work", title: "Work", colour: "#2f7fe8", source: "iCloud", kind: "calDAV", included: true },
  { calendarId: "seed-home", title: "Home", colour: "#34a853", source: "iCloud", kind: "calDAV", included: true },
  { calendarId: "seed-uni", title: "University", colour: "#a05ad6", source: "Exchange", kind: "exchange", included: true },
  { calendarId: "seed-holidays", title: "Australian Holidays", colour: "#d9a400", source: "Subscriptions", kind: "subscription", included: false },
] satisfies Omit<Doc<"calendars">, "_id" | "_creationTime">[];

type SeedCommitment = [
  calendar: string,
  title: string,
  day: number,
  start: number,
  end: number,
  extra?: { availability?: Availability; response?: Response; allDay?: boolean; recurring?: boolean },
];

const COMMITMENTS: SeedCommitment[] = [
  ["seed-work", "Team standup", -2, 9.5, 9.75, { recurring: true }],
  ["seed-uni", "Research seminar", -2, 13, 14],
  ["seed-work", "Team standup", -1, 9.5, 9.75, { recurring: true }],
  ["seed-home", "Physio", -1, 16, 16.75],
  ["seed-work", "Team standup", 0, 9.5, 9.75, { recurring: true }],
  ["seed-home", "Lunch with Priya", 0, 12.5, 13.5],
  ["seed-uni", "Thesis supervision", 0, 15, 16],
  ["seed-work", "Team standup", 1, 9.5, 9.75, { recurring: true }],
  ["seed-home", "Dentist", 1, 11, 11.75],
  ["seed-uni", "COMP3900 lecture", 2, 10, 12],
  ["seed-work", "Sprint review", 2, 14, 15, { availability: "tentative" }],
  ["seed-work", "Vendor demo", 2, 15.5, 16.5, { response: "declined" }],
  ["seed-home", "Mum's birthday", 3, 0, 24, { allDay: true, availability: "free" }],
  ["seed-home", "Gym", 3, 7, 8],
  ["seed-work", "Team standup", 4, 9.5, 9.75, { recurring: true }],
  ["seed-work", "Quarterly planning", 4, 10, 15.5],
];

type SeedBlock = [title: string, day: number, start: number, minutes: number];

const BLOCKS: SeedBlock[] = [
  ["Submit the ethics form", -2, 10, 45],
  ["Review pull request for the vault picker", -2, 14.5, 60],
  ["Reply to Harry about the October invoice", -1, 10, 30],
  ["Draft the thesis outline", 0, 10, 90],
  ["Review the onboarding copy", 0, 14, 45],
  ["Bill Harry for Paperless", 1, 9.75, 30],
  ["Tutorial marking, week 11", 2, 12.5, 90],
];

const ESTIMATES: [title: string, minutes: number][] = [
  ["Get moleskine notebooks from Officeworks", 30],
  ["Ask Priya about the reading group", 15],
  ["Idea: weekly review as a single page", 45],
];

export const seedTimebox = async (ctx: MutationCtx, today: IsoDate, timeZone: string) => {
  const moment = (day: number, hour: number) => zonedMoment(addDays(today, day), Math.round(hour * 60), timeZone);
  for (const calendar of CALENDARS) await ctx.db.insert("calendars", calendar);
  for (const [calendarId, title, day, start, end, extra = {}] of COMMITMENTS) {
    await ctx.db.insert("externalCommitments", {
      calendarId,
      eventKey: `seed-${title}-${day}`,
      title,
      start: moment(day, start),
      end: moment(day, end),
      allDay: extra.allDay ?? false,
      availability: extra.availability ?? "busy",
      ...(extra.response ? { response: extra.response } : {}),
      recurring: extra.recurring ?? false,
    });
  }
  await ctx.db.insert("calendarSync", { syncedAt: moment(0, 8), windowStart: moment(-7, 0), windowEnd: moment(61, 0) });
  const tasks = await ctx.db.query("tasks").take(500);
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  for (const [title, minutes] of ESTIMATES) {
    const task = byTitle.get(title);
    if (task) await ctx.db.patch("tasks", task._id, { estimateMinutes: minutes });
  }
  for (const [title, day, start, minutes] of BLOCKS) {
    const task = byTitle.get(title);
    if (task) await ctx.db.insert("workBlocks", { taskId: task._id, start: moment(day, start), minutes, timeZone, done: false });
  }
};

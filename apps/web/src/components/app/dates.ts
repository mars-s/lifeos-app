import { localIsoDate, type IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import type { DeadlineMark } from "@/components/lifeos/task-row";

const DAY_MS = 86_400_000;

export const UPCOMING_DAYS = 28;
const LOCALE = "en-AU";

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

const format = (options: Intl.DateTimeFormatOptions) => {
  const formatter = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" });
  return (date: string) => formatter.format(utc(date)).replaceAll(",", "");
};

export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

export const weekdayLong = format({ weekday: "long" });
export const dayNumber = format({ day: "numeric" });
export const monthLong = format({ month: "long" });
export const shortDay = format({ weekday: "short", day: "numeric", month: "short" });
export const longDay = format({ weekday: "long", day: "numeric", month: "long" });

export const relativeDay = (date: string, today: string) => {
  const delta = daysBetween(today, date);
  return delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : delta === -1 ? "Yesterday" : undefined;
};

export const deadlineMark = (deadline: string, today: string) => {
  const delta = daysBetween(today, deadline);
  return {
    label: shortDay(deadline),
    countdown: delta === 0 ? "today" : delta > 0 ? `${delta}d left` : `${-delta}d late`,
    overdue: delta < 0,
  } satisfies DeadlineMark;
};

export const whenLabel = (when: PlannerTask["when"], today: string) => {
  if (when.kind === "inbox") return "Inbox";
  if (when.kind === "anytime") return "Anytime";
  if (when.kind === "someday") return "Someday";
  if (when.date <= today) return when.evening ? "This Evening" : "Today";
  return relativeDay(when.date, today) ?? shortDay(when.date);
};

export const isToday = (when: PlannerTask["when"], today: string) => when.kind === "scheduled" && when.date <= today;

const clock = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });
export const clockTime = (at: number) => clock.format(at).replace(/\s/g, " ");

export const localDate = (at: number) => localIsoDate(new Date(at));

export const startOfLocalDay = (date: IsoDate) => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};

export const endOfLocalDay = (date: IsoDate) => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day + 1).getTime() - 1;
};

export const timeAgo = (at: number, now: number) => {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}\u00A0min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}\u00A0h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
};

export const momentAt = (date: IsoDate, minute: number) => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(year, month - 1, day, 0, minute).getTime();
};

export const minuteOfDay = (at: number) => {
  const moment = new Date(at);
  return moment.getHours() * 60 + moment.getMinutes();
};

export const weekdayShort = format({ weekday: "short" });
export const dayMonth = format({ day: "numeric", month: "short" });
export const monthYear = format({ month: "long", year: "numeric" });
export const monthYearShort = format({ month: "short", year: "numeric" });
export const monthShort = format({ month: "short" });

export const startOfWeek = (date: IsoDate) => {
  const weekday = new Date(utc(date)).getUTCDay();
  return new Date(utc(date) - ((weekday + 6) % 7) * DAY_MS).toISOString().slice(0, 10) as IsoDate;
};

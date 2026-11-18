import {
  Archive,
  CalendarCheck,
  CalendarDots,
  MoonStars,
  Plus,
  Stack,
  Star,
  Timer,
  Tray,
} from "@phosphor-icons/react";
import type { ActivityDay } from "@/components/lifeos/activity-timeline";
import type { AreaColour } from "@/components/lifeos/area";
import type { Commitment, WorkBlock } from "@/components/lifeos/calendar-strip";
import type { PlannedSlice } from "@/components/lifeos/capacity";
import type { Command } from "@/components/lifeos/command-palette";
import type { AreaTime, DayTotals } from "@/components/lifeos/review";
import type { TaskDetail, TaskLabel } from "@/components/lifeos/task-card";
import type { TaskSummary } from "@/components/lifeos/task-row";

export const AREAS = [
  { name: "University", colour: "violet" },
  { name: "Personal", colour: "green" },
  { name: "Paperless", colour: "orange" },
  { name: "Korvant", colour: "teal" },
  { name: "Chemwatch", colour: "rose" },
] as const satisfies readonly { name: string; colour: AreaColour }[];

const [university, personal, paperless, korvant, chemwatch] = AREAS;

export const TODAY_TASKS: TaskSummary[] = [
  {
    id: "outline",
    title: "Draft the thesis outline",
    area: university,
    project: "Honours thesis",
    estimate: 90,
    plannedAt: "10:00",
    deadline: { label: "Fri 21", countdown: "3d left" },
    checklist: { done: 1, total: 3 },
  },
  {
    id: "invoice",
    title: "Reply to Harry about the October invoice",
    area: paperless,
    estimate: 15,
    plannedAt: "1:30",
  },
  {
    id: "onboarding",
    title: "Review the onboarding copy",
    area: korvant,
    project: "Launch",
    estimate: 45,
    deadline: { label: "Mon 17", countdown: "1d late", overdue: true },
  },
  { id: "physio", title: "Book a physio appointment", area: personal, estimate: 10 },
];

export const ROW_STATES: TaskSummary[] = [
  TODAY_TASKS[0]!,
  { id: "sds", title: "Check the SDS export against the new template", area: chemwatch, estimate: 30, plannedAt: "3:00" },
  {
    id: "tax",
    title: "Lodge the tax return",
    area: personal,
    deadline: { label: "Mon 17", countdown: "1d late", overdue: true },
  },
  { id: "groceries", title: "Order groceries for the week", area: personal, estimate: 20, plannedAt: "5:30" },
  { id: "sail", title: "Learn to sail", area: personal, someday: true },
];

export const LABELS: TaskLabel[] = [
  { name: "Deep Work", colour: "plum" },
  { name: "Admin", colour: "slate" },
  { name: "Errand", colour: "olive" },
];

export const CARD_TASKS: TaskDetail[] = [
  {
    id: "card-outline",
    title: "Draft the thesis outline",
    area: university,
    project: "Honours thesis",
    estimate: 60,
    plannedAt: "10:00",
    deadline: { label: "Fri 21 Nov", countdown: "3d left" },
    notes: "Three chapters at most. Start from the reading notes, not a blank page.",
    when: "Today",
    labels: ["Deep Work"],
    items: [
      { id: "a", title: "Pull quotes from the reading notes", done: true },
      { id: "b", title: "Write one line per chapter", done: false },
      { id: "c", title: "Send to Dr Nguyen for a read", done: false },
    ],
  },
  {
    id: "card-invoice",
    title: "Reply to Harry about the October invoice",
    area: paperless,
    estimate: 15,
    notes: "",
    when: "Today",
    labels: ["Admin"],
    items: [],
  },
  {
    id: "card-physio",
    title: "Book a physio appointment",
    area: personal,
    estimate: 10,
    notes: "",
    when: "Anytime",
    labels: [],
    items: [],
  },
];

export const PLANNABLE: (PlannedSlice & { title: string })[] = [
  { id: "outline", title: "Thesis outline", colour: "violet", minutes: 90 },
  { id: "onboarding", title: "Onboarding copy", colour: "teal", minutes: 45 },
  { id: "invoice", title: "October invoice", colour: "orange", minutes: 15 },
  { id: "sds", title: "SDS export", colour: "rose", minutes: 60 },
  { id: "tutorial", title: "Tutorial prep", colour: "violet", minutes: 120 },
  { id: "run", title: "Evening run", colour: "green", minutes: 45 },
];

export const HERO_PLANNED: PlannedSlice[] = [
  { id: "outline", colour: "violet", minutes: 90 },
  { id: "onboarding", colour: "teal", minutes: 45 },
  { id: "invoice", colour: "orange", minutes: 15 },
  { id: "physio", colour: "green", minutes: 15 },
];

export const COMMITMENTS: Commitment[] = [
  { title: "COMP3900 lecture", source: "Apple Calendar", start: 9 * 60, end: 10 * 60 },
  { title: "Lunch with Priya", source: "Apple Calendar", start: 12 * 60 + 30, end: 13 * 60 + 15 },
];

export const WORK_BLOCK: WorkBlock = {
  title: "Draft the thesis outline",
  colour: "violet",
  start: 10 * 60 + 15,
  duration: 90,
};

export const SHUTDOWN_AREAS: AreaTime[] = [
  { name: "University", colour: "violet", minutes: 135 },
  { name: "Korvant", colour: "teal", minutes: 80 },
  { name: "Paperless", colour: "orange", minutes: 40 },
  { name: "Personal", colour: "green", minutes: 20 },
];

export const WEEK_TOTALS: DayTotals[] = [
  { day: "Monday", estimate: 300, actual: 330 },
  { day: "Tuesday", estimate: 270, actual: 275 },
  { day: "Wednesday", estimate: 360, actual: 450 },
  { day: "Thursday", estimate: 240, actual: 210 },
  { day: "Friday", estimate: 330, actual: 300 },
  { day: "Saturday", estimate: 120, actual: 150 },
  { day: "Sunday", estimate: 60, actual: 30 },
];

const ACTIVITY_DAYS = 63;
const LAST_DAY = Date.UTC(2026, 10, 18);
const dayLabel = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const noise = (seed: number) => {
  const wave = Math.sin(seed * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
};

export const ACTIVITY: ActivityDay[] = Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
  const date = new Date(LAST_DAY - (ACTIVITY_DAYS - 1 - index) * 86_400_000);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const swell = 2.4 + Math.sin(index / 6) * 1.6;
  return {
    label: dayLabel.format(date),
    count: Math.max(0, Math.min(6, Math.round((weekend ? 0.4 : 1) * swell + noise(index) * 2.4))),
  };
});

export const HEAT_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const HEAT_HOURS = Array.from({ length: 14 }, (_, index) => index + 7);
export const HEAT_MINUTES = HEAT_WEEKDAYS.map((_, day) =>
  HEAT_HOURS.map((hour) => {
    const morning = Math.exp(-((hour - 10) ** 2) / 5);
    const evening = Math.exp(-((hour - 16) ** 2) / 7) * 0.7;
    const weight = day > 4 ? 0.3 : 1;
    const value = (morning + evening) * weight * 150 + noise(day * 31 + hour) * 40 - 22;
    return Math.max(0, Math.round(value / 5) * 5);
  }),
);

export const COMMANDS: Command[] = [
  { id: "today", group: "Go to", label: "Today", icon: Star, keys: "g+t" },
  { id: "inbox", group: "Go to", label: "Inbox", icon: Tray, keys: "g+i" },
  { id: "upcoming", group: "Go to", label: "Upcoming", icon: CalendarDots, keys: "g+u" },
  { id: "anytime", group: "Go to", label: "Anytime", icon: Stack },
  { id: "someday", group: "Go to", label: "Someday", icon: Archive },
  { id: "new", group: "Actions", label: "New Task", icon: Plus, keys: "n" },
  { id: "focus", group: "Actions", label: "Start a Focus Session", icon: Timer, keys: "f" },
  { id: "plan", group: "Actions", label: "Plan the day", icon: CalendarCheck, keys: "mod+p" },
  { id: "shutdown", group: "Actions", label: "Shutdown", icon: MoonStars, keys: "mod+shift+s" },
];

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

export const BOARD_TODAY = "2026-11-18";

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
    deadlineDate: "2026-11-21",
    blocks: [{ id: "block-outline", day: "Today", startMinute: 600, minutes: 60, done: false }],
    notes: "Three chapters at most. Start from the reading notes, not a blank page.",
    when: { kind: "scheduled", date: BOARD_TODAY, evening: false },
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
    when: { kind: "scheduled", date: BOARD_TODAY, evening: false },
    labels: ["Admin"],
    items: [],
  },
  {
    id: "card-physio",
    title: "Book a physio appointment",
    area: personal,
    estimate: 10,
    notes: "",
    when: { kind: "anytime" },
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

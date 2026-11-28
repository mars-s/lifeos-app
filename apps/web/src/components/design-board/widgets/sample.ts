import type { Area, AreaId, Day, Deadline, Slice, Span, Task } from "./model";

export const AREAS: Record<AreaId, Area> = {
  university: { name: "University", colour: "violet" },
  personal: { name: "Personal", colour: "green" },
  paperless: { name: "Paperless", colour: "orange" },
  korvant: { name: "Korvant", colour: "teal" },
  chemwatch: { name: "Chemwatch", colour: "rose" },
};

const at = (hour: number, minute = 0) => hour * 60 + minute;

export const NOW = at(9, 41);
export const WORKING = { start: at(9), end: at(17, 30) };
export const CAPACITY = 450;
export const DATE = "Mon 30 Nov";

export const TASKS: Task[] = [
  { id: "methods", title: "Methods draft", area: "university", estimate: 90, start: at(10, 5) },
  { id: "review", title: "Review onboarding PR", area: "korvant", estimate: 45, start: at(13, 15) },
  { id: "sds", title: "Fix the SDS import", area: "chemwatch", estimate: 60, start: at(14, 15) },
  { id: "physio", title: "Book the physio", area: "personal", estimate: 15 },
  { id: "timesheet", title: "Send the timesheet", area: "paperless", estimate: 15, start: at(16) },
  { id: "rail", title: "Pick a rail pass", area: "personal", estimate: 30 },
];

export const PLANNED = TASKS.reduce((sum, task) => sum + task.estimate, 0);

export const TODAY_SLICES: Slice[] = TASKS.map((task) => ({ colour: AREAS[task.area].colour, minutes: task.estimate }));

export const SPANS: Span[] = [
  { id: "trip", start: at(9, 53), end: at(10, 5), kind: "trip" },
  { id: "methods", start: at(10, 5), end: at(11, 35), kind: "block", colour: "violet" },
  { id: "supervision", start: at(12), end: at(13), kind: "commitment" },
  { id: "review", start: at(13, 15), end: at(14), kind: "block", colour: "teal" },
  { id: "sds", start: at(14, 15), end: at(15, 15), kind: "block", colour: "rose" },
  { id: "timesheet", start: at(16), end: at(16, 15), kind: "block", colour: "orange" },
];

export const NEXT = {
  task: TASKS[0] as Task,
  start: at(10, 5),
  end: at(11, 35),
  place: "Library",
  trip: 12,
  leave: at(9, 53),
};

export const FOCUS = { task: "Methods draft", area: "university" as AreaId, planned: 25, elapsed: 6, left: "18:42", round: 2, rounds: 4 };

export const BRAIN_DUMP = 6;

export const WEEK: Day[] = [
  { id: "mon", letter: "M", weekday: "Mon", date: 30, capacity: CAPACITY, slices: TODAY_SLICES, today: true },
  {
    id: "tue",
    letter: "T",
    weekday: "Tue",
    date: 1,
    capacity: 510,
    slices: [
      { colour: "teal", minutes: 180 },
      { colour: "violet", minutes: 120 },
      { colour: "green", minutes: 30 },
    ],
  },
  {
    id: "wed",
    letter: "W",
    weekday: "Wed",
    date: 2,
    capacity: 360,
    slices: [
      { colour: "rose", minutes: 120 },
      { colour: "violet", minutes: 60 },
    ],
  },
  {
    id: "thu",
    letter: "T",
    weekday: "Thu",
    date: 3,
    capacity: 420,
    deadline: true,
    slices: [
      { colour: "violet", minutes: 240 },
      { colour: "teal", minutes: 120 },
      { colour: "orange", minutes: 60 },
    ],
  },
  {
    id: "fri",
    letter: "F",
    weekday: "Fri",
    date: 4,
    capacity: 510,
    deadline: true,
    slices: [
      { colour: "teal", minutes: 90 },
      { colour: "rose", minutes: 60 },
    ],
  },
  { id: "sat", letter: "S", weekday: "Sat", date: 5, capacity: 120, slices: [{ colour: "green", minutes: 60 }] },
  { id: "sun", letter: "S", weekday: "Sun", date: 6, capacity: 0, slices: [] },
];

export const WEEK_FREE = WEEK.reduce((sum, day) => sum + Math.max(0, day.capacity - day.slices.reduce((total, slice) => total + slice.minutes, 0)), 0);

export const DEADLINES: Deadline[] = [
  { id: "methods", title: "Methods draft", area: "university", day: "Thu", days: 3 },
  { id: "handover", title: "Onboarding handover", area: "korvant", day: "Fri", days: 4 },
  { id: "rail", title: "Book the rail pass", area: "personal", day: "9 Dec", days: 9 },
];

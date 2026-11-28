import type { GuRow } from "./runtime.js";

const still = (done: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f1ece2"/><rect x="32" y="44" width="${90 + (done % 60)}" height="14" rx="7" fill="#2b2926"/><rect x="32" y="72" width="150" height="10" rx="5" fill="#2b2926" opacity=".3"/><rect x="32" y="92" width="110" height="10" rx="5" fill="#2b2926" opacity=".3"/><rect x="232" y="${130 - (done % 80)}" width="44" height="${20 + (done % 80)}" rx="5" fill="#2b2926"/></svg>`,
  )}`;

const TASKS: GuRow[] = [
  { id: "t1", title: "Draft the methods section", area: "University", project: "Thesis", when: "Today", estimate: 90, done: "no" },
  { id: "t2", title: "Mark week 9 quizzes", area: "University", project: "Tutoring", when: "Today", estimate: 45, done: "no" },
  { id: "t3", title: "Review the SDS import PR", area: "Chemwatch", project: "Importer", when: "Today", estimate: 30, done: "no" },
  { id: "t4", title: "Fix the timesheet rounding", area: "Paperless", project: "Timesheets", when: "Today", estimate: 60, done: "no" },
  { id: "t5", title: "Book the Hobart ferry", area: "Personal", project: "Hobart", when: "Today", estimate: 10, done: "no" },
  { id: "t6", title: "Call the bank", area: "Personal", project: "", when: "Today", estimate: 15, done: "no" },
];

export const READS: Record<string, () => GuRow[]> = {
  list_tasks: () => TASKS.map((task) => ({ ...task })),
  get_focus: () => [{ task: "Draft the methods section", minutes: 25, elapsed: 9, running: "yes" }],
  get_day_plan: () => [{ planned: 250, free: 420, goal: 300, busy: 120 }],
};

export const READ_NAMES = Object.keys(READS);

export const SOCKETS: Record<string, () => GuRow[]> = {
  frames: () => [{ done: 128, total: 240, eta: 6, last: still(128) }],
};

export const frameStill = still;

export const TOOLS = ["start_focus", "stop_focus", "create_task", "set_task_status", "stop_run"] as const;

export const SAID: Record<string, string> = {
  start_focus: "Focus Session started",
  stop_focus: "Focus Session stopped",
  create_task: "Task added to the Inbox",
  set_task_status: "Task updated",
  stop_run: "Run stopped. The frames so far are kept",
};

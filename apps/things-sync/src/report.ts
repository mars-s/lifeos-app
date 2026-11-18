import type { FunctionReturnType } from "convex/server";
import type { api } from "@lifeos/backend/api";
import type { ReadError, ThingsRows, TokenError } from "./things.ts";

type ImportResult = FunctionReturnType<typeof api.planner.things.importRows>;
export type ImportReport = Extract<ImportResult, { ok: true }>["value"];
type Skipped = ImportReport["skipped"][number];

const TABLES = [
  ["areas", "Areas"],
  ["labels", "Labels"],
  ["projects", "Projects"],
  ["headings", "Headings"],
  ["tasks", "Tasks"],
  ["checklistItems", "Checklist Items"],
] as const;

const REASONS = {
  repeating_template: "a repeating template, not a real to-do",
  invalid_date: "an impossible date",
  unknown_status: "a status LifeOS does not know",
  unknown_type: "a kind of item LifeOS does not know",
  unknown_start: "a start LifeOS does not know",
  missing_parent: "its parent was not imported",
} as const satisfies Record<Skipped["reason"], string>;

const longDate = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));

export const retiredLine = (retiredAt: number) =>
  `Things was retired on ${longDate(retiredAt)}. LifeOS no longer reads from Things.`;

export const importLines = (report: ImportReport) => [
  ...TABLES.map(([table, label]) => {
    const { inserted, updated, unchanged } = report[table];
    return `  ${label}: ${inserted} new, ${updated} changed, ${unchanged} unchanged`;
  }),
  ...(report.skipped.length === 0
    ? []
    : [
        `  Skipped ${report.skipped.length}:`,
        ...report.skipped.map(({ uuid, title, reason }) => `    "${title || "Untitled"}" (${uuid}): ${REASONS[reason]}`),
      ]),
];

export const readErrorLine = (error: ReadError | TokenError) => {
  if (error.kind === "permission_denied") {
    return [
      `macOS would not let this terminal read ${error.path}.`,
      "Give your terminal app Full Disk Access (System Settings, Privacy & Security, Full Disk Access),",
      'or allow it to "access data from other apps" when macOS asks, then run this again.',
    ].join("\n");
  }
  if (error.kind === "things_not_found") return `Could not find a Things database at ${error.path}. Is Things 3 installed?`;
  if (error.kind === "token_missing") {
    return "No Worker token. Set LIFEOS_THINGS_SYNC_TOKEN or add it to the Keychain as lifeos-app-things-sync.";
  }
  return `Could not read Things: ${error.detail}`;
};

type Item = ThingsRows["items"][number];

const TO_DO = 0;
const PROJECT = 1;
const HEADING = 2;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export const packedDate = (packed: number) =>
  `${pad(packed >> 16, 4)}-${pad((packed >> 12) & 15)}-${pad((packed >> 7) & 31)}`;

const listOf = (item: Item, today: string) => {
  if (item.trashed) return "Trash";
  if (item.status === 3) return "Logbook completed";
  if (item.status === 2) return "Logbook canceled";
  if (item.startDate !== null) {
    if (packedDate(item.startDate) > today) return "Upcoming";
    return item.evening ? "This Evening" : "Today";
  }
  return item.start === 0 ? "Inbox" : item.start === 2 ? "Someday" : "Anytime";
};

const projectStatusOf = (item: Item) =>
  item.trashed ? "trashed" : item.status === 3 ? "completed" : item.status === 2 ? "canceled" : "open";

export const dryRunCounts = (rows: ThingsRows, today: string) => {
  const real = rows.items.filter((item) => !item.repeating);
  const toDos = real.filter((item) => item.type === TO_DO);
  const lists = ["Inbox", "Today", "This Evening", "Upcoming", "Anytime", "Someday", "Logbook completed", "Logbook canceled", "Trash"];
  const projects = real.filter((item) => item.type === PROJECT);
  return [
    ...lists.map((list) => [list, toDos.filter((item) => listOf(item, today) === list).length] as const),
    ...["open", "completed", "canceled", "trashed"].map(
      (status) => [`Projects ${status}`, projects.filter((item) => projectStatusOf(item) === status).length] as const,
    ),
    ["Areas", rows.areas.length] as const,
    ["Headings", real.filter((item) => item.type === HEADING).length] as const,
    ["Checklist Items", rows.checklistItems.length] as const,
    ["Tags", rows.tags.length] as const,
    ["Repeating templates", rows.items.length - real.length] as const,
  ];
};

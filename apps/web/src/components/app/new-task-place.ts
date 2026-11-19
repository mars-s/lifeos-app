import { Result } from "neverthrow";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";

type When = PlannerTask["when"];
type Parent = PlannerTask["parent"];

export type NewTaskPlace = { slot: string; when: When; parent?: Parent };

const DAY_MINUTES = 24 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const placeAttr = (place: NewTaskPlace) => ({ "data-new-task": JSON.stringify(place) });

const parseJson = Result.fromThrowable((raw: string) => JSON.parse(raw) as unknown, () => "not_json" as const);

const asRecord = (value: unknown) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined);

const readWhen = (raw: unknown) => {
  const value = asRecord(raw);
  if (value?.kind === "inbox" || value?.kind === "anytime" || value?.kind === "someday") return { kind: value.kind } satisfies When;
  if (value?.kind !== "scheduled" || typeof value.date !== "string" || !ISO_DATE.test(value.date)) return undefined;
  return { kind: "scheduled", date: value.date, evening: value.evening === true } satisfies When;
};

const readParent = (raw: unknown) => {
  const value = asRecord(raw);
  if (value?.kind === "loose") return { kind: "loose" } satisfies Parent;
  if (value?.kind === "area" && typeof value.areaId === "string") return { kind: "area", areaId: value.areaId as Id<"areas"> } satisfies Parent;
  if (value?.kind !== "project" || typeof value.projectId !== "string") return undefined;
  const projectId = value.projectId as Id<"projects">;
  return (
    typeof value.headingId === "string" ? { kind: "project", projectId, headingId: value.headingId as Id<"headings"> } : { kind: "project", projectId }
  ) satisfies Parent;
};

export const readPlace = (raw: string | undefined) => {
  const value = asRecord(raw ? parseJson(raw).unwrapOr(null) : null);
  const when = readWhen(value?.when);
  if (!value || typeof value.slot !== "string" || !when) return undefined;
  if (value.parent === undefined) return { slot: value.slot, when } satisfies NewTaskPlace;
  const parent = readParent(value.parent);
  return parent && ({ slot: value.slot, when, parent } satisfies NewTaskPlace);
};

export const startUnderPointer = (pointerMinute: number, minutes: number, snap: number) =>
  Math.min(Math.max(0, Math.floor(pointerMinute / snap) * snap), DAY_MINUTES - minutes);

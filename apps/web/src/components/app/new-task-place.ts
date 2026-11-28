import { Option, Predicate, Schema } from "effect";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask } from "@lifeos/backend/types";

type When = PlannerTask["when"];
type Parent = PlannerTask["parent"];

export type NewTaskPlace = { slot: string; when: When; parent?: Parent };

const DAY_MINUTES = 24 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const placeAttr = (place: NewTaskPlace) => ({ "data-new-task": JSON.stringify(place) });

const tableId = <T extends "areas" | "projects" | "headings">() => Schema.declare(Predicate.isString as (input: unknown) => input is Id<T>);

const WhenField = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["inbox", "anytime", "someday"]) }),
  Schema.Struct({ kind: Schema.Literal("scheduled"), date: Schema.String.check(Schema.isPattern(ISO_DATE)), evening: Schema.Boolean }),
]);

const ParentField = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("loose") }),
  Schema.Struct({ kind: Schema.Literal("area"), areaId: tableId<"areas">() }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: tableId<"projects">(), headingId: Schema.optionalKey(tableId<"headings">()) }),
]);

const PlaceJson = Schema.fromJsonString(Schema.Struct({ slot: Schema.String, when: WhenField, parent: Schema.optionalKey(ParentField) }));

const decodePlace = Schema.decodeUnknownOption(PlaceJson);

export const readPlace = (raw: string | undefined) =>
  Option.getOrUndefined(
    Option.map(decodePlace(raw), ({ slot, when, parent }) => (parent ? { slot, when, parent } : { slot, when }) satisfies NewTaskPlace),
  );

export const startUnderPointer = (pointerMinute: number, minutes: number, snap: number) =>
  Math.min(Math.max(0, Math.floor(pointerMinute / snap) * snap), DAY_MINUTES - minutes);

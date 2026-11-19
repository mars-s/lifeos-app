import { describe, expect, test } from "vitest";
import { placeAttr, readPlace, startUnderPointer, type NewTaskPlace } from "./new-task-place";

const places: NewTaskPlace[] = [
  { slot: "/planner", when: { kind: "inbox" } },
  { slot: "/planner:2026-11-20", when: { kind: "scheduled", date: "2026-11-20", evening: false } },
  { slot: "/today:evening", when: { kind: "scheduled", date: "2026-11-19", evening: true } },
  { slot: "/anytime:a1", when: { kind: "anytime" }, parent: { kind: "area", areaId: "a1" as never } },
  { slot: "/project/p1:h1", when: { kind: "anytime" }, parent: { kind: "project", projectId: "p1" as never, headingId: "h1" as never } },
];

describe("readPlace", () => {
  test.each(places)("reads back what placeAttr wrote for $slot", (place) => {
    expect(readPlace(placeAttr(place)["data-new-task"])).toEqual(place);
  });

  test.each([
    undefined,
    "",
    "not json",
    "null",
    '{"slot":"/x"}',
    '{"slot":"/x","when":{"kind":"tomorrow"}}',
    '{"slot":"/x","when":{"kind":"scheduled","date":"20 Nov","evening":false}}',
    '{"slot":"/x","when":{"kind":"anytime"},"parent":{"kind":"area"}}',
    '{"slot":3,"when":{"kind":"inbox"}}',
  ])("refuses %s", (raw) => {
    expect(readPlace(raw)).toBeUndefined();
  });
});

describe("startUnderPointer", () => {
  test("snaps down to the slot the pointer is in", () => {
    expect(startUnderPointer(14 * 60 + 40, 30, 15)).toBe(14 * 60 + 30);
  });

  test("keeps the block inside the day", () => {
    expect(startUnderPointer(23 * 60 + 50, 30, 15)).toBe(23 * 60 + 30);
    expect(startUnderPointer(-20, 30, 15)).toBe(0);
  });
});

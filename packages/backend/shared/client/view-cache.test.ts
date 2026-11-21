import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test } from "vitest";
import type { Updater } from "./local-views";
import { forgetViews, holdUnsaved, keepViewsOn, lastSeenView, offlineView, readUnsaved, settleView } from "./view-cache";

const NAME = "planner/lists:inbox";
const ARGS = JSON.stringify({ date: "2026-11-21" });
const KEY = `${NAME}:${ARGS}`;
const inbox = makeFunctionReference<"query">(NAME);

const task = (id: string, title = id) => ({ _id: id, title });

const memoryDisk = (saved: Record<string, unknown> = {}) => {
  const reads: string[] = [];
  const writes: [string, unknown][] = [];
  return {
    reads,
    writes,
    disk: {
      read: (key: string) => {
        reads.push(key);
        return saved[key];
      },
      write: (key: string, value: unknown) => void writes.push([key, value]),
    },
  };
};

const retitle = (id: string, title: string) =>
  ((store) => {
    const tasks = store.getQuery(inbox, JSON.parse(ARGS) as Record<string, string>) as { _id: string; title: string }[] | undefined;
    if (tasks) store.setQuery(inbox, JSON.parse(ARGS) as Record<string, string>, tasks.map((each) => (each._id === id ? { ...each, title } : each)));
  }) satisfies Updater;

afterEach(() => {
  keepViewsOn(null);
  forgetViews();
});

describe("saved views", () => {
  test("shows the view saved on the phone before the live answer arrives", () => {
    const { disk } = memoryDisk({ [KEY]: [task("a"), task("b")] });
    keepViewsOn(disk);
    expect(lastSeenView(KEY)).toEqual([task("a"), task("b")]);
  });

  test("reads each view from the phone once, even when nothing was saved", () => {
    const { disk, reads } = memoryDisk();
    keepViewsOn(disk);
    lastSeenView(KEY);
    lastSeenView(KEY);
    expect(reads).toEqual([KEY]);
  });

  test("keeps the saved rows when the live answer matches, so nothing redraws", () => {
    const { disk, writes } = memoryDisk({ [KEY]: [task("a"), task("b")] });
    keepViewsOn(disk);
    const saved = lastSeenView(KEY) as unknown[];
    const kept = settleView(KEY, [task("a"), task("b", "Renamed")]) as unknown[];
    expect(kept[0]).toBe(saved[0]);
    expect(kept[1]).toEqual(task("b", "Renamed"));
    expect(writes).toEqual([[KEY, kept]]);
  });

  test("saves nothing when the live answer is what the phone already had", () => {
    const { disk, writes } = memoryDisk({ [KEY]: [task("a")] });
    keepViewsOn(disk);
    settleView(KEY, [task("a")]);
    expect(writes).toEqual([]);
  });

  test("forgets every view on sign-out", () => {
    settleView(KEY, [task("a")]);
    forgetViews();
    expect(lastSeenView(KEY)).toBeUndefined();
  });
});

describe("changes made offline", () => {
  test("show on the saved view until they are sent", () => {
    keepViewsOn(memoryDisk({ [KEY]: [task("a", "Old")] }).disk);
    const release = holdUnsaved(retitle("a", "New"));
    expect(offlineView(readUnsaved(), NAME, ARGS)).toEqual([task("a", "New")]);
    release();
    expect(offlineView(readUnsaved(), NAME, ARGS)).toEqual([task("a", "Old")]);
  });

  test("leave other views alone", () => {
    const other = JSON.stringify({ date: "2026-11-22" });
    keepViewsOn(memoryDisk({ [`${NAME}:${other}`]: [task("a", "Old")] }).disk);
    const release = holdUnsaved(retitle("a", "New"));
    expect(offlineView(readUnsaved(), NAME, other)).toEqual([task("a", "Old")]);
    release();
  });
});

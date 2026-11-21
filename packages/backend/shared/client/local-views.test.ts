import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { putBack, rewriteView, type Node, type Updater } from "./local-views";

const task = (id: string, title = id) => ({ _id: id, title, checklist: [], labelIds: [] });

const trashed = (...ids: string[]) => (node: Node) => ids.includes(node._id as string);

describe("putBack", () => {
  test("returns a removed row to its place between its neighbours", () => {
    const before = { tasks: [task("a"), task("b"), task("c")] };
    const now = { tasks: [task("a"), task("c")] };
    expect(putBack(before, now, trashed("b"))).toEqual({ tasks: [task("a"), task("b"), task("c")] });
  });

  test("puts a first row back at the top and several rows back in their old order", () => {
    const before = [task("a"), task("b"), task("c"), task("d")];
    expect(putBack(before, [task("c")], trashed("a", "b", "d"))).toEqual(before);
  });

  test("keeps what changed on the other rows since", () => {
    const before = [task("a"), task("b", "Old title")];
    const now = [task("b", "New title")];
    expect(putBack(before, now, trashed("a"))).toEqual([task("a"), task("b", "New title")]);
  });

  test("brings back a group that left with its last row", () => {
    const before = { groups: [{ key: "home", tasks: [task("a")] }, { key: "work", tasks: [task("b")] }] };
    const now = { groups: [{ key: "home", tasks: [task("a")] }] };
    expect(putBack(before, now, trashed("b"))).toEqual(before);
  });

  test("leaves a row that something else removed out of the list", () => {
    const before = [task("a"), task("b"), task("c")];
    expect(putBack(before, [task("c")], trashed("a"))).toEqual([task("a"), task("c")]);
  });

  test("keeps a row that arrived since", () => {
    const before = [task("a"), task("b")];
    expect(putBack(before, [task("b"), task("new")], trashed("a"))).toEqual([task("a"), task("b"), task("new")]);
  });

  test("hands back the same value when nothing was lost", () => {
    const now = { ok: true, value: { tasks: [task("a")], evening: [] } };
    expect(putBack({ ok: true, value: { tasks: [task("a")], evening: [] } }, now, trashed("z"))).toBe(now);
  });

  test("restores rows inside sections that have no name of their own", () => {
    const before = { sections: [{ heading: null, tasks: [task("a")] }, { heading: { _id: "h" }, tasks: [task("b"), task("c")] }] };
    const now = { sections: [{ heading: null, tasks: [task("a")] }, { heading: { _id: "h" }, tasks: [task("c")] }] };
    expect(putBack(before, now, trashed("b"))).toEqual(before);
  });
});

const inbox = makeFunctionReference<"query">("planner/lists:inbox");
const today = makeFunctionReference<"query">("planner/today:get");

const renameEverywhere: Updater = (store) => {
  for (const view of [inbox, today]) {
    for (const { args, value } of store.getAllQueries(view)) {
      store.setQuery(view, args, (value as { title: string }[]).map((row) => ({ ...row, title: "Renamed" })));
    }
  }
};

const patchToday: Updater = (store) => {
  const args = { days: 7, date: "2026-11-19" };
  if (store.getQuery(today, args) !== undefined) store.setQuery(today, args, "patched");
};

describe("rewriteView", () => {
  test("shows one view as the update leaves it", () => {
    expect(rewriteView(renameEverywhere, "planner/lists:inbox", {}, [task("a")])).toEqual([task("a", "Renamed")]);
  });

  test("leaves a view the update does not name as it was", () => {
    const shown = [task("a")];
    expect(rewriteView(renameEverywhere, "planner/lists:someday", {}, shown)).toBe(shown);
  });

  test("answers a read of the same view whatever order its arguments come in", () => {
    expect(rewriteView(patchToday, "planner/today:get", { date: "2026-11-19", days: 7 }, "live")).toBe("patched");
    expect(rewriteView(patchToday, "planner/today:get", { date: "2026-11-20", days: 7 }, "live")).toBe("live");
  });
});

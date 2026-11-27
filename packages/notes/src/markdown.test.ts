import { expect, test } from "vitest";
import { formatEntityLink, projectNote, titleOf } from "./markdown.ts";

test("the title is the first line without its heading mark", () => {
  expect(titleOf("\n\n## Dense and **sparse**\nbody")).toBe("Dense and sparse");
  expect(titleOf("   \n")).toBe("Untitled");
});

test("a projection finds chips, note links and Labels, and skips code", () => {
  const text = [
    "# Thesis outline",
    "- [ ] Draft the [[Retrieval reading|reading]] section",
    `- ${formatEntityLink({ table: "tasks", id: "k57abc", alias: "Read papers" })}`,
    "Part of [[project:p1]] in [[area:a1]]. #thesis #2026 #reading/list",
    "```",
    "[[Not a link]] #nottag",
    "```",
  ].join("\n");
  const note = projectNote(text);
  expect(note.title).toBe("Thesis outline");
  expect(note.entities).toEqual([
    { table: "tasks", id: "k57abc", alias: "Read papers" },
    { table: "projects", id: "p1" },
    { table: "areas", id: "a1" },
  ]);
  expect(note.noteTitles).toEqual(["Retrieval reading"]);
  expect(note.labels).toEqual(["thesis", "reading/list"]);
  expect(note.excerpt).toBe("Draft the reading section Read papers Part of in . #thesis #2026 #reading/list");
});

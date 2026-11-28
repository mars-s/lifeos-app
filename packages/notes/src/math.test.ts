import { expect, test } from "vitest";
import { findMath } from "./math.ts";

const tex = (text: string) => findMath(text).map((span) => [span.tex, span.display]);

test("inline maths sits between single dollars on one line", () => {
  expect(tex("so $yo twin$ works")).toEqual([["yo twin", false]]);
  expect(tex("$a$ and $b^2$")).toEqual([
    ["a", false],
    ["b^2", false],
  ]);
  expect(findMath("x $E=mc^2$ y")).toEqual([{ from: 2, to: 10, tex: "E=mc^2", display: false }]);
});

test("money is not maths", () => {
  expect(tex("$5 and $10")).toEqual([]);
  expect(tex("it costs $5, or $6 with tax")).toEqual([]);
  expect(tex("between $ 1 and 2 $")).toEqual([]);
  expect(tex("$a $")).toEqual([]);
  expect(tex("$a$5 then $b$")).toEqual([["a$5 then $b", false]]);
});

test("inline maths does not cross a line break", () => {
  expect(tex("$a\nb$")).toEqual([]);
});

test("a backslash escapes a dollar", () => {
  expect(tex("\\$5 and \\$6")).toEqual([]);
  expect(tex("\\$a$")).toEqual([]);
  expect(tex("$a \\$ b$")).toEqual([["a \\$ b", false]]);
  expect(tex("\\\\$a$")).toEqual([["a", false]]);
});

test("double dollars are display maths and may span lines", () => {
  expect(tex("$$\n\\int_0^1 x\\,dx\n$$")).toEqual([["\n\\int_0^1 x\\,dx\n", true]]);
  expect(tex("so $$ x + y $$ here")).toEqual([[" x + y ", true]]);
  expect(tex("$$\na\n\nb\n$$")).toEqual([["\na\n\nb\n", true]]);
});

test("empty or unclosed double dollars are left alone", () => {
  expect(tex("$$$$")).toEqual([]);
  expect(tex("$$ $$")).toEqual([]);
  expect(tex("$$\nx + y")).toEqual([]);
});

test("code is never maths", () => {
  expect(tex("`$a$` and $b$")).toEqual([["b", false]]);
  expect(tex("``$a` $b$``")).toEqual([]);
  expect(tex("```\n$a$\n```\n$b$")).toEqual([["b", false]]);
  expect(tex("  ~~~tex\n$$x$$\n~~~")).toEqual([]);
  expect(tex("```\n$a$")).toEqual([]);
});

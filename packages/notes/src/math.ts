export type MathSpan = {
  readonly from: number;
  readonly to: number;
  readonly tex: string;
  readonly display: boolean;
};

const fenceOpen = /^[ \t]*(`{3,}|~{3,})/;
const fenceClose = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const space = /\s/;
const digit = /\d/;

const lineEndAt = (text: string, at: number) => {
  const next = text.indexOf("\n", at);
  return next === -1 ? text.length : next;
};

const fenceEnd = (text: string, at: number) => {
  const open = fenceOpen.exec(text.slice(at, lineEndAt(text, at)))?.[1];
  if (!open) return null;
  for (let line = lineEndAt(text, at) + 1; line <= text.length; line = lineEndAt(text, line) + 1) {
    const end = lineEndAt(text, line);
    const close = fenceClose.exec(text.slice(line, end))?.[1];
    if (close && close[0] === open[0] && close.length >= open.length) return end;
  }
  return text.length;
};

const runOf = (text: string, at: number, char: string) => {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
};

const codeSpanEnd = (text: string, at: number, ticks: number) => {
  for (let i = at + ticks; i < text.length; i++) {
    if (text[i] !== "`") continue;
    const run = runOf(text, i, "`");
    if (run === ticks) return i + run;
    i += run - 1;
  }
  return null;
};

const displayEnd = (text: string, at: number) => {
  for (let i = at + 2; i < text.length - 1; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "$" && text[i + 1] === "$") return i;
  }
  return null;
};

const inlineEnd = (text: string, at: number) => {
  const end = lineEndAt(text, at);
  for (let i = at + 1; i < end; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "$" && !space.test(text[i - 1] ?? " ") && !digit.test(text[i + 1] ?? "")) return i;
  }
  return null;
};

export const findMath = (text: string) => {
  const spans: MathSpan[] = [];
  let i = 0;
  while (i < text.length) {
    if (i === 0 || text[i - 1] === "\n") {
      const fence = fenceEnd(text, i);
      if (fence !== null) {
        i = fence + 1;
        continue;
      }
    }
    const char = text[i];
    if (char === "\\") {
      i += 2;
    } else if (char === "`") {
      const ticks = runOf(text, i, "`");
      i = codeSpanEnd(text, i, ticks) ?? i + ticks;
    } else if (char === "$" && text[i + 1] === "$") {
      const close = displayEnd(text, i);
      const tex = close === null ? "" : text.slice(i + 2, close);
      if (close !== null && tex.trim().length > 0) spans.push({ from: i, to: close + 2, tex, display: true });
      i = close === null ? i + 2 : close + 2;
    } else if (char === "$" && !space.test(text[i + 1] ?? " ")) {
      const close = inlineEnd(text, i);
      if (close !== null) spans.push({ from: i, to: close + 1, tex: text.slice(i + 1, close), display: false });
      i = close === null ? i + 1 : close + 1;
    } else {
      i++;
    }
  }
  return spans;
};

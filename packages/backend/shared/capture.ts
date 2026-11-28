import { Result } from "effect";
import { addDays, parseIsoDate, type IsoDate } from "./date";
import { MAX_ESTIMATE_MINUTES } from "./estimate";

export type CaptureWhen = { kind: "scheduled"; date: IsoDate; evening: boolean } | { kind: "anytime" } | { kind: "someday" };

export type CaptureField = "when" | "deadline" | "estimate" | "label" | "list";

export type CaptureToken = { field: CaptureField; start: number; end: number; text: string };

export type Capture = {
  title: string;
  when?: CaptureWhen;
  deadline?: IsoDate;
  estimateMinutes?: number;
  labels: readonly string[];
  list?: string;
  tokens: readonly CaptureToken[];
};

export type CaptureOptions = { literal?: ReadonlySet<string> };

type Word = { text: string; start: number; end: number };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MAX_PHRASE_WORDS = 3;

const ESTIMATE_HOURS = /^(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?$/;
const ESTIMATE_MINUTES = /^(\d+)(?:m|min|mins)$/;
const IN_SPAN = /^in (\d{1,3}) ?(d|day|days|w|wk|week|weeks)$/;
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})$/;
const MONTH_DAY = /^([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?$/;
const TAG = /^[#@]([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u;

export const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

const named = (names: readonly string[], text: string) =>
  text.length < 3 ? -1 : names.findIndex((name) => name === text || (text.length <= 5 && name.startsWith(text)));

const weekdayOf = (date: IsoDate) => new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();

const comingWeekday = (today: IsoDate, weekday: number) => addDays(today, ((weekday - weekdayOf(today) + 6) % 7) + 1);

const nextMonday = (today: IsoDate) => comingWeekday(today, 1);

const pad = (n: number) => String(n).padStart(2, "0");

const dayInMonth = (today: IsoDate, day: number, month: number) => {
  const year = Number(today.slice(0, 4));
  const thisYear = parseIsoDate(`${year}-${pad(month + 1)}-${pad(day)}`);
  if (Result.isSuccess(thisYear) && thisYear.success >= today) return thisYear.success;
  const nextYear = parseIsoDate(`${year + 1}-${pad(month + 1)}-${pad(day)}`);
  return Result.getOrUndefined(nextYear);
};

const dateOf = (phrase: string, today: IsoDate) => {
  if (phrase === "today" || phrase === "tod") return today;
  if (phrase === "tomorrow" || phrase === "tmr" || phrase === "tmrw" || phrase === "tom") return addDays(today, 1);
  if (phrase === "next week") return nextMonday(today);
  if (phrase === "next month") {
    const first = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`));
    first.setUTCMonth(first.getUTCMonth() + 1);
    return first.toISOString().slice(0, 10) as IsoDate;
  }
  if (phrase === "this weekend" || phrase === "weekend") return weekdayOf(today) === 6 ? today : comingWeekday(today, 6);
  const weekday = named(WEEKDAYS, phrase);
  if (weekday !== -1) return comingWeekday(today, weekday);
  if (phrase.startsWith("next ")) {
    const later = named(WEEKDAYS, phrase.slice(5));
    if (later !== -1) return addDays(nextMonday(today), (later + 6) % 7);
  }
  const span = IN_SPAN.exec(phrase);
  if (span) return addDays(today, Number(span[1]) * (span[2]?.startsWith("w") ? 7 : 1));
  const dayFirst = DAY_MONTH.exec(phrase);
  const monthFirst = MONTH_DAY.exec(phrase);
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
  const month = named(MONTHS, dayFirst?.[2] ?? monthFirst?.[1] ?? "");
  return month !== -1 && day >= 1 && day <= 31 ? dayInMonth(today, day, month) : undefined;
};

export const parseDatePhrase = (input: string, today: IsoDate) => dateOf(input.trim().toLowerCase().replace(/\s+/g, " "), today);

export const parseWhenPhrase = (input: string, today: IsoDate) => {
  const phrase = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (phrase === "tonight" || phrase === "this evening" || phrase === "evening") {
    return { kind: "scheduled", date: today, evening: true } satisfies CaptureWhen;
  }
  if (phrase === "someday") return { kind: "someday" } satisfies CaptureWhen;
  if (phrase === "anytime") return { kind: "anytime" } satisfies CaptureWhen;
  const date = dateOf(phrase, today);
  return date ? ({ kind: "scheduled", date, evening: false } satisfies CaptureWhen) : undefined;
};

export const parseEstimateToken = (input: string) => {
  const text = input.toLowerCase();
  const hours = ESTIMATE_HOURS.exec(text);
  const minutes = hours ? Math.round(Number(hours[1]) * 60 + Number(hours[2] ?? 0)) : Number(ESTIMATE_MINUTES.exec(text)?.[1]);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= MAX_ESTIMATE_MINUTES ? minutes : undefined;
};

const wordsOf = (input: string) => [...input.matchAll(/\S+/g)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }) satisfies Word);

const phraseAt = (words: readonly Word[], at: number, length: number, input: string) => {
  const last = words[at + length - 1];
  const first = words[at];
  return first && last ? { text: input.slice(first.start, last.end), start: first.start, end: last.end } : undefined;
};

export const parseCapture = (input: string, today: IsoDate, options: CaptureOptions = {}) => {
  const words = wordsOf(input);
  const literal = options.literal ?? new Set<string>();
  const tokens: CaptureToken[] = [];
  const labels: string[] = [];
  const kept: string[] = [];
  let when: CaptureWhen | undefined;
  let deadline: IsoDate | undefined;
  let estimateMinutes: number | undefined;
  let list: string | undefined;

  const take = (field: CaptureField, phrase: { text: string; start: number; end: number }) => tokens.push({ field, ...phrase });

  const readAt = (at: number) => {
    for (let length = Math.min(MAX_PHRASE_WORDS, words.length - at); length >= 1; length -= 1) {
      const phrase = phraseAt(words, at, length, input);
      if (!phrase || literal.has(phrase.text.toLowerCase())) continue;
      const lower = phrase.text.toLowerCase();
      if (lower.startsWith("!") && deadline === undefined) {
        const date = parseDatePhrase(lower.slice(1), today);
        if (date) {
          deadline = date;
          take("deadline", phrase);
          return length;
        }
      }
      if (when === undefined && !lower.startsWith("!")) {
        const parsed = parseWhenPhrase(lower, today);
        if (parsed) {
          when = parsed;
          take("when", phrase);
          return length;
        }
      }
    }
    const word = words[at];
    if (!word || literal.has(word.text.toLowerCase())) return 0;
    const minutes = estimateMinutes === undefined ? parseEstimateToken(word.text) : undefined;
    if (minutes !== undefined) {
      estimateMinutes = minutes;
      take("estimate", word);
      return 1;
    }
    const tag = TAG.exec(word.text)?.[1];
    if (tag && word.text.startsWith("#") && !labels.includes(slugOf(tag))) {
      labels.push(slugOf(tag));
      take("label", word);
      return 1;
    }
    if (tag && word.text.startsWith("@") && list === undefined) {
      list = slugOf(tag);
      take("list", word);
      return 1;
    }
    return 0;
  };

  for (let at = 0; at < words.length; ) {
    const used = readAt(at);
    if (used === 0) kept.push(words[at]?.text ?? "");
    at += Math.max(1, used);
  }

  return {
    title: kept.join(" "),
    ...(when ? { when } : {}),
    ...(deadline ? { deadline } : {}),
    ...(estimateMinutes === undefined ? {} : { estimateMinutes }),
    labels,
    ...(list ? { list } : {}),
    tokens,
  } satisfies Capture;
};

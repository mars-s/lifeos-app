import { jsonSchema, tool, type JSONSchema7 } from "ai";
import { Result } from "effect";
import { zonedMoment } from "../calendar/model";
import { parseIsoDate } from "../../shared/date";

export const MAX_PROPOSED_STEPS = 8;

const DRAFTED = { drafted: true, saved: false } as const;

const object = (properties: Record<string, JSONSchema7>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }) satisfies JSONSchema7;

const why = { type: "string", description: "One short sentence on why, for Avi to read under the draft." } satisfies JSONSchema7;

const minuteOf = (start: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  const minute = match ? Number(match[1]) * 60 + Number(match[2]) : Number.NaN;
  return minute >= 0 && minute < 24 * 60 && Number(match?.[2]) < 60 ? minute : null;
};

export const proposalTools = (timeZone: string) => ({
  propose_steps: tool({
    description: `Draft ${MAX_PROPOSED_STEPS} or fewer Checklist steps for the Task, each a short imperative action under 60 characters, in order. Nothing is saved until Avi keeps it.`,
    inputSchema: jsonSchema<{ steps: string[]; why: string }>(object({ steps: { type: "array", items: { type: "string" }, maxItems: MAX_PROPOSED_STEPS }, why })),
    execute: async () => DRAFTED,
  }),
  propose_estimate: tool({
    description: "Draft an Estimate for the Task, in whole minutes. Nothing is saved until Avi keeps it.",
    inputSchema: jsonSchema<{ minutes: number; why: string }>(object({ minutes: { type: "integer", minimum: 5, maximum: 12000 }, why })),
    execute: async () => DRAFTED,
  }),
  propose_time: tool({
    description: "Draft one Work Block for the Task: a date (YYYY-MM-DD), a start time (HH:MM, 24 hour) in Avi's time zone and its length in minutes. Read get_day_plan first so it lands in a free gap. Nothing is saved until Avi keeps it.",
    inputSchema: jsonSchema<{ date: string; start: string; minutes: number; why: string }>(
      object({ date: { type: "string" }, start: { type: "string" }, minutes: { type: "integer", minimum: 15, maximum: 480 }, why }),
    ),
    execute: async ({ date, start, minutes }) => {
      const day = parseIsoDate(date);
      const minute = minuteOf(start);
      if (Result.isFailure(day) || minute === null) return { refused: "Give a real date as YYYY-MM-DD and a start as HH:MM." };
      return { ...DRAFTED, start: zonedMoment(day.success, minute, timeZone), minutes, timeZone, date: day.success };
    },
  }),
  propose_notes: tool({
    description: "Draft text to add to the end of the Task's notes, such as an email or a plan. Plain text, no Markdown headings. Nothing is saved until Avi keeps it.",
    inputSchema: jsonSchema<{ text: string; why: string }>(object({ text: { type: "string" }, why })),
    execute: async () => DRAFTED,
  }),
});

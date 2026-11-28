import { at, type Area, type AreaId, type BlockEntry, type CommitmentEntry, type Day, type Entry, type Trip } from "./model";

export const AREAS: Record<AreaId, Area> = {
  university: { name: "University", colour: "violet" },
  paperless: { name: "Paperless", colour: "orange" },
  korvant: { name: "Korvant", colour: "teal" },
  personal: { name: "Personal", colour: "green" },
};

export const NOW = at(12, 40);
export const TODAY_INDEX = 2;

type Flags = { done?: boolean; guess?: boolean; trip?: Trip };

const block = (kept: boolean) => (id: string, title: string, area: AreaId, start: number, minutes: number, flags: Flags = {}) =>
  ({ kind: "block", id, title, area, start, minutes, kept, done: false, ...flags }) satisfies BlockEntry;

const kept = block(true);
const predicted = block(false);

const commitment = (id: string, title: string, calendar: "Work" | "Home" | "University", start: number, minutes: number, place?: string) =>
  ({
    kind: "commitment",
    id,
    title,
    start,
    minutes,
    calendar,
    colour: ({ Work: "slate", Home: "olive", University: "plum" } as const)[calendar],
    ...(place ? { place } : {}),
  }) satisfies CommitmentEntry;

const standup = (day: string) => commitment(`${day}-standup`, "Team standup", "Work", at(8, 30), 15);

const day = (date: string, weekday: string, number: number, entries: Entry[]) => ({ date, weekday, number, entries }) satisfies Day;

export const WEEK: readonly Day[] = [
  day("2026-11-23", "Mon", 23, [
    standup("mon"),
    kept("mon-outline", "Outline chapter three", "university", at(9), 90, { done: true }),
    kept("mon-invoices", "Invoice run for Paperless", "paperless", at(10, 40), 45, { done: true }),
    commitment("mon-lecture", "COMP3900 lecture", "University", at(13), 120, "Building 14"),
    kept("mon-empty-state", "Fix the onboarding empty state", "korvant", at(15, 10), 60),
    kept("mon-washing", "Hang the washing", "personal", at(16, 20), 15, { done: true }),
  ]),
  day("2026-11-24", "Tue", 24, [
    standup("tue"),
    kept("tue-read", "Read Karpukhin on dense retrieval", "university", at(9), 60, { done: true }),
    kept("tue-methods", "Draft the methods section", "university", at(10, 10), 90, { done: true }),
    commitment("tue-seminar", "Lunch seminar", "University", at(12), 60, "Room 2.14"),
    kept("tue-notes", "Paperless release notes", "paperless", at(13, 15), 45),
    kept("tue-dentist", "Call the dentist", "personal", at(14, 10), 15, { done: true }),
    commitment("tue-bee", "Working bee", "Work", at(15), 60),
    kept("tue-review", "Korvant onboarding review", "korvant", at(16, 10), 50, { done: true }),
  ]),
  day("2026-11-25", "Wed", 25, [
    standup("wed"),
    kept("wed-outline", "Draft the thesis outline", "university", at(9, 10), 90, { done: true }),
    kept("wed-harry", "Reply to Harry about the invoice", "paperless", at(10, 50), 20),
    kept("wed-physio", "Book a physio appointment", "personal", at(11, 15), 15, { done: true }),
    commitment("wed-lunch", "Lunch with Priya", "Home", at(12), 60, "Glen Waverley"),
    kept("wed-copy", "Review the onboarding copy", "korvant", at(13, 15), 45),
    predicted("wed-email", "Email the reading group", "university", at(14, 10), 15),
    kept("wed-parcel", "Pick up the parcel", "personal", at(14, 45), 20, { trip: { place: "Australia Post, Clayton", minutes: 15 } }),
    commitment("wed-supervision", "Thesis supervision", "University", at(15, 30), 45, "Woodside 3.07"),
    predicted("wed-papers", "Read two papers on retrieval", "university", at(16, 45), 45, { guess: true }),
  ]),
  day("2026-11-26", "Thu", 26, [
    standup("thu"),
    predicted("thu-revise", "Revise the thesis outline", "university", at(9), 90),
    kept("thu-prep", "Group meeting prep", "university", at(10, 40), 45),
    commitment("thu-group", "COMP3900 group meeting", "University", at(11, 30), 60, "Building 14"),
    predicted("thu-bill", "Bill Harry for Paperless", "paperless", at(13, 15), 20),
    predicted("thu-bee", "Weekly working bee prep", "paperless", at(13, 45), 30),
    commitment("thu-dentist", "Dentist", "Home", at(15), 45, "Clayton Dental"),
    predicted("thu-findings", "Write up the onboarding findings", "korvant", at(16), 60, { guess: true }),
  ]),
  day("2026-11-27", "Fri", 27, [
    standup("fri"),
    predicted("fri-methods", "Methods draft, second pass", "university", at(9), 120),
    commitment("fri-catchup", "Supervisor catch-up", "University", at(11, 30), 30),
    predicted("fri-checklist", "Paperless 1.0 checklist", "paperless", at(13), 90),
    predicted("fri-groceries", "Groceries for the weekend", "personal", at(16), 30, { trip: { place: "Coles, Clayton", minutes: 15 } }),
  ]),
  day("2026-11-28", "Sat", 28, [
    commitment("sat-brunch", "Brunch with Sam", "Home", at(10, 30), 90, "Oakleigh"),
    predicted("sat-japan", "Plan the Japan trip days", "personal", at(14), 60, { guess: true }),
  ]),
  day("2026-11-29", "Sun", 29, []),
];

export const BRAIN_DUMP = ["Get moleskine notebooks from Officeworks", "Ask Priya about the reading group", "Idea: weekly review as a single page", "Renew the car registration"];

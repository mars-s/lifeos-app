"use client";

import { Archive, CalendarDots, CaretLeft, CaretRight, Flag, Moon, Stack, Star, Tray, type Icon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { cn } from "@/lib/utils";
import { MenuRow, ToolButton } from "./tool-button";

export type WhenValue =
  | { kind: "inbox" }
  | { kind: "anytime" }
  | { kind: "someday" }
  | { kind: "scheduled"; date: string; evening: boolean };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const pad = (value: number) => String(value).padStart(2, "0");
const monthTitle = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
const dayTitle = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const monthOf = (date: string) => date.slice(0, 7);

const shiftMonth = (month: string, step: number) => {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + step, 1));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`;
};

const daysIn = (month: string) => {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const blanks = (new Date(Date.UTC(year, index - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { blanks, dates: Array.from({ length: count }, (_, day) => `${month}-${pad(day + 1)}`) };
};

const StayOpen = ({ children }: { asChild: true; children: ReactNode }) => children;

const ARROW_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export const MonthGrid = ({
  value,
  today,
  tone,
  closeOnPick = true,
  onPick,
}: {
  value: string | undefined;
  today: string;
  tone: "brand" | "deadline";
  closeOnPick?: boolean;
  onPick: (date: string) => void;
}) => {
  const Close = closeOnPick ? PopoverClose : StayOpen;
  const [month, setMonth] = useState(monthOf(value && value >= today ? value : today));
  const { blanks, dates } = daysIn(month);
  const firstMonth = monthOf(today);
  return (
    <div className="px-1 pt-1 pb-1.5">
      <div className="mb-1 flex items-center">
        <p aria-live="polite" className="flex-1 pl-1.5 text-small font-medium">
          {monthTitle.format(Date.parse(`${month}-01T00:00:00Z`))}
        </p>
        {(
          [
            [-1, CaretLeft, "Earlier month"],
            [1, CaretRight, "Later month"],
          ] as const
        ).map(([step, Caret, label]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={step === -1 && month <= firstMonth}
            onClick={() => setMonth(shiftMonth(month, step))}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.9] disabled:pointer-events-none disabled:opacity-30"
          >
            <Caret weight="bold" className="size-3.5" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div
        role="group"
        aria-label="Pick a date"
        className="grid grid-cols-7 justify-items-center gap-y-0.5"
        onKeyDown={(event) => {
          const step = ARROW_STEPS[event.key];
          if (step === undefined || !(event.target instanceof HTMLElement)) return;
          event.preventDefault();
          event.stopPropagation();
          const days = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
          days[days.indexOf(event.target) + step]?.focus();
        }}
      >
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} aria-hidden="true" className="grid h-6 w-8 place-items-center text-micro text-faint-foreground">
            {weekday.slice(0, 1)}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span key={index} aria-hidden="true" />
        ))}
        {dates.map((date) => (
          <Close key={date} asChild>
            <button
              type="button"
              disabled={date < today}
              aria-label={dayTitle.format(Date.parse(`${date}T00:00:00Z`))}
              aria-pressed={date === value}
              onClick={() => onPick(date)}
              className={cn(
                "grid size-8 place-items-center rounded-full text-small tabular-nums transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.9] disabled:pointer-events-none disabled:text-faint-foreground/60",
                date === value
                  ? tone === "brand"
                    ? "bg-brand font-medium text-brand-foreground"
                    : "bg-deadline font-medium text-background"
                  : "hover:bg-foreground/[0.07]",
                date === today && date !== value && "font-semibold text-brand",
              )}
            >
              {Number(date.slice(8))}
            </button>
          </Close>
        ))}
      </div>
    </div>
  );
};

export const whenIcon = (when: WhenValue, today: string) =>
  ((
    {
      inbox: Tray,
      anytime: Stack,
      someday: Archive,
      scheduled: when.kind === "scheduled" && when.date <= today ? (when.evening ? Moon : Star) : CalendarDots,
    } satisfies Record<WhenValue["kind"], Icon>
  )[when.kind]);

const isToday = (when: WhenValue, today: string) => when.kind === "scheduled" && when.date <= today;

export const WhenPicker = ({
  when,
  label,
  today,
  onChange,
}: {
  when: WhenValue;
  label: string;
  today: string;
  onChange: (when: WhenValue) => void;
}) => {
  const trigger = (
    <ToolButton
      icon={whenIcon(when, today)}
      label={`When: ${label}`}
      active
      className={cn("pr-2.5", isToday(when, today) && "[&>svg]:text-brand")}
    >
      <span className="pl-1.5 font-medium">{label}</span>
    </ToolButton>
  );
  const options = [
    { label: "Today", icon: Star, value: { kind: "scheduled", date: today, evening: false }, selected: isToday(when, today) && when.kind === "scheduled" && !when.evening },
    { label: "This Evening", icon: Moon, value: { kind: "scheduled", date: today, evening: true }, selected: isToday(when, today) && when.kind === "scheduled" && when.evening },
  ] as const satisfies readonly { label: string; icon: Icon; value: WhenValue; selected: boolean }[];
  const later = [
    { label: "Anytime", icon: Stack, value: { kind: "anytime" } },
    { label: "Someday", icon: Archive, value: { kind: "someday" } },
  ] as const satisfies readonly { label: string; icon: Icon; value: WhenValue }[];
  return (
    <Popover align="start" className="w-[17rem] p-1.5" trigger={trigger}>
      {options.map(({ label: name, icon: OptionIcon, value, selected }) => (
        <PopoverClose key={name} asChild>
          <MenuRow selected={selected} onClick={() => onChange(value)}>
            <OptionIcon weight="fill" className={cn("size-4", name === "Today" ? "text-brand" : "text-muted-foreground")} aria-hidden="true" />
            {name}
          </MenuRow>
        </PopoverClose>
      ))}
      <div className="my-1.5 border-t border-border" />
      <MonthGrid
        value={when.kind === "scheduled" && when.date > today ? when.date : undefined}
        today={today}
        tone="brand"
        onPick={(date) => onChange({ kind: "scheduled", date, evening: false })}
      />
      <div className="my-1.5 border-t border-border" />
      {later.map(({ label: name, icon: OptionIcon, value }) => (
        <PopoverClose key={name} asChild>
          <MenuRow selected={when.kind === value.kind} onClick={() => onChange(value)}>
            <OptionIcon weight="fill" className="size-4 text-muted-foreground" aria-hidden="true" />
            {name}
          </MenuRow>
        </PopoverClose>
      ))}
    </Popover>
  );
};

export const DeadlinePicker = ({
  deadline,
  label,
  overdue,
  today,
  onChange,
}: {
  deadline: string | undefined;
  label: string | undefined;
  overdue?: boolean;
  today: string;
  onChange: (deadline: string | null) => void;
}) => {
  const trigger = label ? (
    <ToolButton icon={Flag} label={`Deadline: ${label}`} active className={cn("pr-2.5", overdue ? "text-negative" : "text-deadline")}>
      <span className="pl-1.5 font-medium">{label}</span>
    </ToolButton>
  ) : (
    <ToolButton icon={Flag} label="Deadline" />
  );
  return (
    <Popover align="end" className="w-[17rem] p-1.5" trigger={trigger}>
      <MonthGrid value={deadline} today={today} tone="deadline" onPick={onChange} />
      {deadline && (
        <>
          <div className="my-1.5 border-t border-border" />
          <PopoverClose asChild>
            <MenuRow onClick={() => onChange(null)}>
              <Flag className="size-4 text-muted-foreground" aria-hidden="true" />
              No Deadline
            </MenuRow>
          </PopoverClose>
        </>
      )}
    </Popover>
  );
};

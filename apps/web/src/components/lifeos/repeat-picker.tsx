"use client";

import { Check, Minus, Plus, Repeat, SkipForward } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { IsoDate } from "@lifeos/backend/date";
import { describeSchedule, type RepeatNext } from "@lifeos/backend/recurrence";
import { Button } from "@/components/ui/action-button";
import { Popover, PopoverClose } from "@/components/ui/popover-panel";
import { Segmented } from "@/components/ui/segmented-control";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { MonthGrid } from "./date-pickers";
import {
  AFTER_UNITS,
  MAX_COUNT,
  NEVER,
  UNITS,
  WEEKDAYS,
  clampEvery,
  defaultEndDate,
  draftFrom,
  firstDate,
  isPreset,
  isValidDraft,
  maxEvery,
  repeatDay,
  repeatLabel,
  repeatPresets,
  sameSchedule,
  scheduleFrom,
  scheduleParts,
  type RepeatDraft,
  type RepeatEnd,
  type RepeatMode,
  type Schedule,
} from "@lifeos/backend/client/repeat";
import { MenuRow, ToolButton } from "./tool-button";

type RepeatState = { schedule: Schedule; end: RepeatEnd; next: RepeatNext; settled: boolean };

const UNIT_LABELS = { days: "Day", weeks: "Week", months: "Month", years: "Year" } as const;
const AFTER_LABELS = { day: "Day", week: "Week", month: "Month" } as const;
const END_LABELS = { never: "Never", on: "On a date", after: "After" } as const;

const plural = (count: number, one: string) => (count === 1 ? one : `${one}s`);

export const Stepper = ({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) => {
  const step = (by: number) => {
    const next = Math.min(Math.max(value + by, min), max);
    if (next === value) return;
    haptic("toggle");
    onChange(next);
  };
  const button =
    "relative grid size-7 place-items-center rounded-full text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-1 hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.9] disabled:pointer-events-none disabled:opacity-30";
  return (
    <span role="group" aria-label={label} className="inline-flex h-8 shrink-0 items-center rounded-full bg-foreground/[0.05] p-0.5">
      <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => step(-1)} className={button}>
        <Minus weight="bold" className="size-3" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="min-w-7 text-center font-mono text-small tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => step(1)} className={button}>
        <Plus weight="bold" className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
};

const WeekdayToggles = ({ days, onChange }: { days: readonly number[]; onChange: (days: RepeatDraft["days"]) => void }) => (
  <div role="group" aria-label="On these days" className="flex justify-between">
    {WEEKDAYS.map(([weekday, name]) => {
      const on = days.includes(weekday);
      return (
        <button
          key={weekday}
          type="button"
          aria-label={name}
          aria-pressed={on}
          onClick={() => {
            haptic("toggle");
            onChange(on ? days.filter((day): day is RepeatDraft["days"][number] => day !== weekday) : [...(days as RepeatDraft["days"]), weekday]);
          }}
          className={cn(
            "grid size-8 place-items-center rounded-full text-small font-medium transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.9]",
            on ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
          )}
        >
          {name.charAt(0)}
        </button>
      );
    })}
  </div>
);

const Line = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("flex min-h-8 items-center gap-2 text-small", className)}>{children}</div>
);

const monthlyOn = (on: RepeatDraft["monthDay"] | RepeatDraft["monthWeekday"]) => {
  const text = scheduleParts({ kind: "months", every: 1, on }).qualifier ?? "";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const monthChoices = (draft: RepeatDraft) =>
  [
    { value: "day", label: monthlyOn(draft.monthDay) },
    { value: "weekday", label: monthlyOn(draft.monthWeekday) },
  ] as const;

const Summary = ({ draft, base }: { draft: RepeatDraft; base: IsoDate }) => {
  if (!isValidDraft(draft)) return <p className="text-small text-negative">Pick at least one day.</p>;
  const schedule = scheduleFrom(draft);
  const first = schedule.kind === "afterCompletion" ? null : firstDate(schedule, base);
  return (
    <p className="text-small text-pretty text-muted-foreground">
      <span className="font-medium text-foreground">{repeatLabel(schedule, draft.end)}</span>
      {first && `, starting ${repeatDay(first)}`}
    </p>
  );
};

export const RepeatCustom = ({
  schedule,
  end,
  base,
  today,
  mode,
  cancelLabel,
  onCancel,
  onCommit,
}: {
  schedule: Schedule | undefined;
  end: RepeatEnd;
  base: IsoDate;
  today: string;
  mode: RepeatMode;
  cancelLabel: string;
  onCancel: () => void;
  onCommit: (schedule: Schedule, end: RepeatEnd) => void;
}) => {
  const [draft, setDraft] = useState(() => ({ ...draftFrom(schedule, end, base, mode), mode }));
  const edit = (patch: Partial<RepeatDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const valid = isValidDraft(draft);
  const unitWord = draft.mode === "afterCompletion" ? plural(draft.afterEvery, draft.afterUnit) : plural(draft.every, draft.unit.slice(0, -1));
  return (
    <form
      className="space-y-2.5 p-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onCommit(scheduleFrom(draft), draft.end);
      }}
    >
      <Segmented
        label="Repeat"
        className="flex w-full [&>button]:flex-1"
        value={draft.mode}
        onValueChange={(next) => edit({ mode: next })}
        options={[
          { value: "calendar", label: "On a schedule" },
          { value: "afterCompletion", label: "After I finish it" },
        ]}
      />
      {draft.mode === "calendar" ? (
        <>
          <Segmented
            label="Unit"
            className="flex w-full [&>button]:flex-1 [&>button]:px-1"
            value={draft.unit}
            onValueChange={(unit) => setDraft((current) => clampEvery({ ...current, unit }))}
            options={UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))}
          />
          <Line>
            <span className="text-muted-foreground">Every</span>
            <Stepper value={draft.every} min={1} max={maxEvery(draft)} label="How often" onChange={(every) => edit({ every })} />
            <span>{unitWord}</span>
          </Line>
          {draft.unit === "weeks" && <WeekdayToggles days={draft.days} onChange={(days) => edit({ days })} />}
          {draft.unit === "months" && (
            <Segmented
              label="Which day of the month"
              className="flex w-full [&>button]:flex-1 [&>button]:px-1"
              value={draft.monthOn}
              onValueChange={(monthOn) => edit({ monthOn })}
              options={[...monthChoices(draft)]}
            />
          )}
          {draft.unit === "years" && (
            <Line className="text-muted-foreground">{scheduleParts(scheduleFrom(draft)).qualifier}</Line>
          )}
        </>
      ) : (
        <>
          <Segmented
            label="Unit"
            className="flex w-full [&>button]:flex-1"
            value={draft.afterUnit}
            onValueChange={(afterUnit) => edit({ afterUnit })}
            options={AFTER_UNITS.map((unit) => ({ value: unit, label: AFTER_LABELS[unit] }))}
          />
          <Line>
            <Stepper value={draft.afterEvery} min={1} max={maxEvery(draft)} label="How long after" onChange={(afterEvery) => edit({ afterEvery })} />
            <span>{unitWord} after I finish it</span>
          </Line>
        </>
      )}
      <div className="border-t border-border pt-2.5">
        <p className="mb-1.5 pl-1 text-micro text-faint-foreground">Ends</p>
        <Segmented
          label="Ends"
          className="flex w-full [&>button]:flex-1 [&>button]:px-1"
          value={draft.end.kind}
          onValueChange={(kind) =>
            edit({ end: kind === "never" ? NEVER : kind === "on" ? { kind, date: defaultEndDate(base) } : { kind, count: 5 } })
          }
          options={(["never", "on", "after"] as const).map((kind) => ({ value: kind, label: END_LABELS[kind] }))}
        />
        {draft.end.kind === "on" && (
          <div className="-mx-1 mt-1">
            <MonthGrid value={draft.end.date} today={today} tone="brand" closeOnPick={false} onPick={(date) => edit({ end: { kind: "on", date } })} />
          </div>
        )}
        {draft.end.kind === "after" && (
          <Line className="mt-1.5">
            <Stepper value={draft.end.count} min={1} max={MAX_COUNT} label="How many times" onChange={(count) => edit({ end: { kind: "after", count } })} />
            <span>{draft.end.count === 1 ? "time" : "times"}</span>
          </Line>
        )}
      </div>
      <div className="space-y-2.5 border-t border-border px-1 pt-2.5">
        <Summary draft={draft} base={base} />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Repeat
          </Button>
        </div>
      </div>
    </form>
  );
};

const nextLine = (repeat: RepeatState) => {
  if (repeat.next.kind === "due") return `Next: ${repeatDay(repeat.next.date)}`;
  if (repeat.next.kind === "waiting" && repeat.schedule.kind === "afterCompletion") {
    return `Next: ${describeSchedule(repeat.schedule, NEVER).replace("after completion", "after you finish this")}`;
  }
  return undefined;
};

const ChoiceRow = ({
  selected,
  lead,
  qualifier,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  selected: boolean;
  lead: ReactNode;
  qualifier?: ReactNode;
}) => (
  <MenuRow {...props} className="gap-2">
    <Check weight="bold" className={cn("size-3.5 shrink-0 text-brand", !selected && "invisible")} aria-hidden="true" />
    <span className={cn("min-w-0 truncate", selected && "font-medium")}>
      {lead}
      {qualifier && <span className="font-normal text-faint-foreground"> ({qualifier})</span>}
      {selected && <span className="sr-only">, chosen</span>}
    </span>
  </MenuRow>
);

export const RepeatPicker = ({
  repeat,
  base,
  today,
  onSet,
  onStop,
  onSkip,
}: {
  repeat: RepeatState | undefined;
  base: IsoDate;
  today: string;
  onSet: (schedule: Schedule, end: RepeatEnd) => void;
  onStop: () => void;
  onSkip: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<RepeatMode | null>(null);
  const current = repeat?.schedule;
  const end = repeat?.end ?? NEVER;
  const presets = repeatPresets(base);
  const label = repeat ? repeatLabel(repeat.schedule, repeat.end) : undefined;
  const odd = current && current.kind !== "afterCompletion" && !isPreset(current, base) ? current : undefined;
  const next = repeat && nextLine(repeat);
  const trigger = label ? (
    <ToolButton icon={Repeat} label={`Repeat: ${label}`} active className="max-w-[15rem] pr-2.5">
      <span className="truncate pl-1.5 font-medium">{label}</span>
    </ToolButton>
  ) : (
    <ToolButton icon={Repeat} label="Repeat" />
  );
  return (
    <Popover
      align="end"
      title={custom ? "Custom repeat" : "Repeat"}
      className="max-h-(--radix-popover-content-available-height) w-[17.5rem] overflow-y-auto overscroll-contain p-1.5 pt-3"
      open={open}
      onOpenChange={(opened) => {
        setOpen(opened);
        if (!opened) setCustom(null);
      }}
      trigger={trigger}
    >
      {custom ? (
        <RepeatCustom
          schedule={current}
          end={end}
          base={base}
          today={today}
          mode={custom}
          cancelLabel="Back"
          onCancel={() => setCustom(null)}
          onCommit={(schedule, chosenEnd) => {
            setOpen(false);
            setCustom(null);
            onSet(schedule, chosenEnd);
          }}
        />
      ) : (
        <>
          <PopoverClose asChild>
            <ChoiceRow selected={!repeat} lead="Does not repeat" onClick={() => repeat && onStop()} />
          </PopoverClose>
          {presets.map((preset) => {
            const parts = scheduleParts(preset);
            return (
              <PopoverClose key={JSON.stringify(preset)} asChild>
                <ChoiceRow
                  selected={sameSchedule(preset, current)}
                  lead={parts.lead}
                  qualifier={parts.qualifier}
                  onClick={() => sameSchedule(preset, current) || onSet(preset, end)}
                />
              </PopoverClose>
            );
          })}
          <div className="my-1 border-t border-border" />
          {odd && <ChoiceRow selected lead={repeatLabel(odd, NEVER)} onClick={() => setCustom("calendar")} />}
          <ChoiceRow
            selected={current?.kind === "afterCompletion"}
            lead={current?.kind === "afterCompletion" ? repeatLabel(current, NEVER) : "After I finish it…"}
            onClick={() => setCustom("afterCompletion")}
          />
          <ChoiceRow selected={false} lead="Custom…" onClick={() => setCustom("calendar")} />
          {next && (
            <div className="mt-1 flex min-h-9 items-center gap-2 border-t border-border pt-1 pl-2.5">
              <p className="min-w-0 flex-1 truncate text-small text-muted-foreground">{next}</p>
              {repeat?.next.kind === "due" && (
                <button
                  type="button"
                  disabled={!repeat.settled}
                  onClick={onSkip}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-small font-medium text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.96] disabled:opacity-40"
                >
                  <SkipForward weight="fill" className="size-3.5" aria-hidden="true" />
                  Skip Next
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Popover>
  );
};

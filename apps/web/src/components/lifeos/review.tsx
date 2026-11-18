"use client";

import { useState } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";
import { AreaDot, areaVar, type AreaColour } from "./area";
import { formatMinutes } from "./format";

export type AreaTime = { name: string; colour: AreaColour; minutes: number };

export const AreaBar = ({
  areas,
  active,
  onActiveChange,
  className,
}: {
  areas: AreaTime[];
  active: string | null;
  onActiveChange: (name: string | null) => void;
  className?: string;
}) => (
  <div className={cn("flex h-2.5 gap-[3px]", className)} role="img" aria-label="Actual Time by Area">
    {areas.map((area) => (
      <span
        key={area.name}
        onPointerEnter={() => onActiveChange(area.name)}
        onPointerLeave={() => onActiveChange(null)}
        className={cn(
          "h-full min-w-1.5 rounded-full transition-opacity duration-(--dur-fast) ease-out",
          active && active !== area.name && "opacity-25",
        )}
        style={{ flexGrow: area.minutes, flexBasis: 0, backgroundColor: areaVar(area.colour) }}
      />
    ))}
  </div>
);

export const ShutdownSummary = ({
  day,
  completed,
  planned,
  areas,
  rolling,
}: {
  day: string;
  completed: number;
  planned: number;
  areas: AreaTime[];
  rolling: string[];
}) => {
  const [active, setActive] = useState<string | null>(null);
  const total = areas.reduce((sum, area) => sum + area.minutes, 0);
  return (
    <section className="@container w-full space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-title font-semibold">{day} is done</h3>
          <p className="text-small text-muted-foreground">
            {completed} of {planned} Tasks completed
          </p>
        </div>
        <p className="text-right">
          <RollingNumber value={formatMinutes(total)} className="font-mono text-title font-medium" />
          <span className="block text-small text-muted-foreground">Actual Time</span>
        </p>
      </header>
      <AreaBar areas={areas} active={active} onActiveChange={setActive} />
      <ul>
        {areas.map((area) => (
          <li
            key={area.name}
            onPointerEnter={() => setActive(area.name)}
            onPointerLeave={() => setActive(null)}
            className={cn(
              "-mx-2 flex h-8 items-center gap-2.5 rounded-lg px-2 text-small transition-[background-color,opacity] duration-(--dur-fast)",
              active === area.name && "bg-foreground/[0.05]",
              active && active !== area.name && "opacity-50",
            )}
          >
            <AreaDot colour={area.colour} />
            <span className="flex-1">{area.name}</span>
            <span className="font-mono text-faint-foreground">{Math.round((area.minutes / total) * 100)}%</span>
            <span className="w-10 text-right font-mono">{formatMinutes(area.minutes)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-xl bg-foreground/[0.04] px-3 py-2.5 text-small">
        <p className="text-muted-foreground">Rolls to tomorrow</p>
        <ul className="mt-1 space-y-0.5">
          {rolling.map((title) => (
            <li key={title} className="truncate">
              {title}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export type DayTotals = { day: string; estimate: number; actual: number };

const COLUMN_DOT_MINUTES = 30;

const DotColumn = ({ minutes, rows, className }: { minutes: number; rows: number; className: string }) => {
  const filled = Math.round(minutes / COLUMN_DOT_MINUTES);
  return (
    <span className="flex flex-col-reverse gap-[3px] @lg:gap-1">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className={cn("size-1.5 rounded-full @lg:size-2", index < filled ? className : "bg-transparent")} />
      ))}
    </span>
  );
};

export const EstimateActual = ({ days }: { days: DayTotals[] }) => {
  const [active, setActive] = useState<number | null>(null);
  const rows = Math.ceil(Math.max(...days.flatMap((day) => [day.estimate, day.actual])) / COLUMN_DOT_MINUTES);
  const picked = active === null ? undefined : days[active];
  const shown = picked
    ? { label: picked.day, estimate: picked.estimate, actual: picked.actual }
    : {
        label: "This week",
        estimate: days.reduce((sum, day) => sum + day.estimate, 0),
        actual: days.reduce((sum, day) => sum + day.actual, 0),
      };
  const drift = shown.actual - shown.estimate;
  return (
    <section className="@container w-full space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-small">
        <h3 className="mr-auto text-heading font-medium">{shown.label}</h3>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-foreground/25" />
          Estimate <span className="font-mono text-foreground">{formatMinutes(shown.estimate)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-brand" />
          Actual <span className="font-mono text-foreground">{formatMinutes(shown.actual)}</span>
        </span>
        <span className={cn("font-mono", drift > 0 ? "text-negative" : "text-positive")}>
          {drift > 0 ? "+" : "−"}
          {formatMinutes(Math.abs(drift))}
        </span>
      </header>
      <div className="flex items-end justify-between" onPointerLeave={() => setActive(null)}>
        {days.map((day, index) => (
          <button
            key={day.day}
            type="button"
            aria-label={`${day.day}: Estimate ${formatMinutes(day.estimate)}, Actual ${formatMinutes(day.actual)}`}
            onPointerEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            className={cn(
              "flex flex-col items-center gap-2.5 rounded-lg px-1.5 py-1 transition-opacity duration-(--dur-fast) @md:px-3",
              active !== null && active !== index && "opacity-35",
            )}
          >
            <span className="flex items-end gap-[3px] @lg:gap-1">
              <DotColumn minutes={day.estimate} rows={rows} className="bg-foreground/25" />
              <DotColumn minutes={day.actual} rows={rows} className="bg-brand" />
            </span>
            <span className="font-mono text-micro text-faint-foreground">{day.day.slice(0, 3)}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

const clock = (hour: number) => `${((hour + 11) % 12) + 1} ${hour < 12 ? "am" : "pm"}`;

export const FocusHeatmap = ({
  weekdays,
  hours,
  minutes,
}: {
  weekdays: string[];
  hours: number[];
  minutes: number[][];
}) => {
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null);
  const peak = Math.max(...minutes.flat());
  const at = (day: number, hour: number) => minutes[day]?.[hour] ?? 0;
  return (
    <section className="@container w-full space-y-3">
      <header className="flex items-baseline justify-between gap-4 text-small">
        <h3 className="text-heading font-medium">Focus by hour</h3>
        <p className="font-mono text-muted-foreground">
          {active
            ? `${weekdays[active.day]} ${clock(hours[active.hour] ?? 0)}  ${formatMinutes(at(active.day, active.hour))}`
            : "Last 4 weeks"}
        </p>
      </header>
      <div className="grid gap-1" onPointerLeave={() => setActive(null)}>
        {weekdays.map((weekday, day) => (
          <div key={weekday} className="flex items-center gap-1">
            <span className="w-8 shrink-0 font-mono text-micro text-faint-foreground">{weekday.slice(0, 3)}</span>
            {hours.map((hour, index) => (
              <span
                key={hour}
                onPointerEnter={() => setActive({ day, hour: index })}
                className="grid h-4 flex-1 place-items-center"
              >
                <span
                  className="rounded-full bg-brand transition-[scale] duration-(--dur-fast) ease-out"
                  style={{
                    width: 4 + (at(day, index) / peak) * 8,
                    height: 4 + (at(day, index) / peak) * 8,
                    opacity: at(day, index) === 0 ? 0.14 : 0.3 + (at(day, index) / peak) * 0.7,
                    scale: active?.day === day && active.hour === index ? 1.35 : 1,
                  }}
                />
              </span>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-1 pt-1">
          <span className="w-8 shrink-0" />
          {hours.map((hour, index) => (
            <span key={hour} className="flex-1 text-center font-mono text-micro text-faint-foreground">
              {index % 3 === 0 ? clock(hour).replace(" ", "") : ""}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
};

"use client";

import { areaVar, type AreaColour } from "@/components/lifeos/area";
import { DayMeter } from "@/components/lifeos/capacity";
import { formatClock, formatMinutes, formatRange } from "@/components/lifeos/format";
import { cn } from "@/lib/utils";
import type { DaySpan, LoadDay } from "./model";

const spanTint = (span: DaySpan) => (span.colour ? areaVar(span.colour) : "var(--muted-foreground)");

const spanStyle = (span: DaySpan) => {
  if (span.kind === "commitment") return { backgroundColor: "color-mix(in oklab, var(--foreground) 9%, transparent)" };
  if (span.kind === "pencil") return { backgroundColor: `color-mix(in oklab, ${spanTint(span)} 7%, transparent)`, borderColor: `color-mix(in oklab, ${spanTint(span)} 70%, transparent)` };
  return { backgroundColor: `color-mix(in oklab, ${spanTint(span)} 20%, transparent)` };
};

const SPAN_WORD = { commitment: "Commitment", block: "Work Block", pencil: "Suggested" } as const satisfies Record<DaySpan["kind"], string>;

const spanLabel = (span: DaySpan) => `${SPAN_WORD[span.kind]}: ${span.title}, ${formatRange(span.start, span.start + span.minutes)}`;

export const DayTrack = ({ day, from, to, spans, className }: { day: string; from: number; to: number; spans: DaySpan[]; className?: string }) => {
  const length = to - from;
  const hours = Array.from({ length: length / 60 + 1 }, (_, index) => from + index * 60);
  const pencil = spans.find((span) => span.kind === "pencil");
  return (
    <figure className={cn("w-full min-w-0", className)}>
      <div role="img" aria-label={`${day}. ${spans.map(spanLabel).join(". ")}`} className="relative h-9 rounded-lg bg-foreground/[0.035]">
        {spans.map((span) => (
          <span
            key={`${span.id}-${span.start}`}
            title={spanLabel(span)}
            data-span={span.kind}
            className={cn(
              "absolute inset-y-1 rounded-[5px] transition-[background-color,border-color,opacity] duration-(--dur-base) ease-out",
              span.kind === "pencil" && "animate-fade-in border-[1.5px] border-dashed",
            )}
            style={{ left: `${((span.start - from) / length) * 100}%`, width: `max(5px, calc(${(span.minutes / length) * 100}% - 2px))`, ...spanStyle(span) }}
          >
            {span.kind === "block" && <span className="absolute inset-y-[3px] left-[3px] w-[3px] rounded-full" style={{ backgroundColor: spanTint(span) }} />}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="relative mt-1 h-4">
        {hours.map((hour, index) => (
          <span
            key={hour}
            className={cn("absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5", index % 2 === 1 && "@max-sm:hidden", index === 0 && "translate-x-0", index === hours.length - 1 && "-translate-x-full")}
            style={{ left: `${((hour - from) / length) * 100}%` }}
          >
            <span className="font-mono text-[0.625rem] leading-4 text-faint-foreground">{formatClock(hour).replace(":00", "").replace(" ", "")}</span>
          </span>
        ))}
      </div>
      {pencil && (
        <figcaption className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-small">
          <span className="text-muted-foreground">{day}</span>
          <span className="font-mono text-foreground/85">{formatRange(pencil.start, pencil.start + pencil.minutes)}</span>
          <span className="font-mono text-faint-foreground">{formatMinutes(pencil.minutes)}</span>
        </figcaption>
      )}
    </figure>
  );
};

export const LoadRows = ({ days, className }: { days: LoadDay[]; className?: string }) => (
  <div className={cn("@container", className)}>
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5 @[20rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
      {days.map((day) => {
        const planned = day.slices.reduce((sum, slice) => sum + slice.minutes, 0);
        const total = cn("font-mono text-micro leading-[0.875rem]", planned > day.free ? "text-negative" : "text-foreground/75");
        return (
          <div key={day.label} className="contents">
            <span className="flex flex-col text-micro leading-[0.875rem] text-muted-foreground">
              {day.label}
              <span className={cn(total, "@[20rem]:hidden")}>
                {formatMinutes(planned)}
              </span>
            </span>
            <DayMeter slices={day.slices} goal={day.goal} free={day.free} className="min-w-0 py-1" />
            <span className={cn(total, "hidden @[20rem]:inline")}>{formatMinutes(planned)}</span>
          </div>
        );
      })}
    </div>
  </div>
);

const ROW = 10;

export const ProgressDots = ({ title, colour, done, pencil, total, className }: { title: string; colour: AreaColour; done: number; pencil: number; total: number; className?: string }) => (
  <figure className={cn("w-fit", className)}>
    <div role="img" aria-label={`${title}: ${done} of ${total} Tasks done, ${pencil} more planned this week`} className="grid w-fit gap-[5px]" style={{ gridTemplateColumns: `repeat(${ROW}, 0.5rem)` }}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn("size-2 rounded-full", index >= done + pencil && "bg-foreground/[0.1]")}
          style={index < done ? { backgroundColor: areaVar(colour) } : index < done + pencil ? { boxShadow: `inset 0 0 0 1.5px ${areaVar(colour)}` } : undefined}
        />
      ))}
    </div>
    <figcaption className="mt-2 flex items-baseline gap-2 text-small">
      <span className="font-mono text-foreground/85">
        {done} of {total}
      </span>
      <span className="text-muted-foreground">done</span>
      <span className="font-mono text-faint-foreground">+{pencil} this week</span>
    </figcaption>
  </figure>
);

const HOUR = 44;
const toPx = (minutes: number) => (minutes / 60) * HOUR;

export const DayColumn = ({ from, to, spans, className }: { from: number; to: number; spans: DaySpan[]; className?: string }) => {
  const hours = Array.from({ length: (to - from) / 60 }, (_, index) => from + index * 60);
  return (
    <div className={cn("relative grid grid-cols-[2.25rem_minmax(0,1fr)]", className)} style={{ height: toPx(to - from) }}>
      <div aria-hidden="true" className="relative">
        {hours.map((hour) => (
          <span key={hour} className="absolute right-2 -translate-y-1/2 font-mono text-[0.625rem] leading-4 text-faint-foreground first:translate-y-0" style={{ top: toPx(hour - from) }}>
            {formatClock(hour).replace(":00", "").replace(" ", "")}
          </span>
        ))}
      </div>
      <ul aria-label="The day" className="relative">
        {hours.slice(1).map((hour) => (
          <li key={hour} aria-hidden="true" className="absolute inset-x-0 h-px bg-foreground/[0.05]" style={{ top: toPx(hour - from) }} />
        ))}
        {spans.map((span) => (
          <li
            key={`${span.id}-${span.start}`}
            data-span={span.kind}
            className={cn(
              "absolute inset-x-0 flex items-start gap-1.5 overflow-hidden rounded-md pt-[3px] pr-1.5 pl-1.5 text-micro leading-4 transition-[background-color,border-color] duration-(--dur-base) ease-out",
              span.kind === "pencil" && "animate-fade-in border-[1.5px] border-dashed pt-[1.5px] pl-[4.5px]",
              span.kind === "commitment" && "text-muted-foreground",
            )}
            style={{ top: toPx(span.start - from) + 1, height: toPx(span.minutes) - 2, ...spanStyle(span) }}
          >
            {span.kind === "block" && <span aria-hidden="true" className="mt-px h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: spanTint(span) }} />}
            <span className={cn("min-w-0 flex-1 truncate", span.kind === "pencil" && "text-muted-foreground")}>
              <span className="sr-only">{SPAN_WORD[span.kind]}: </span>
              {span.title}
            </span>
            <span className="hidden shrink-0 font-mono text-faint-foreground @xs:inline">{formatMinutes(span.minutes)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

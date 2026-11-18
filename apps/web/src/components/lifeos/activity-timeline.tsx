"use client";

import { X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";

export type ActivityDay = { label: string; count: number };
export type Brush = { from: number; to: number };

const MAX_ROWS = 6;

export const ActivityTimeline = ({
  days,
  brush,
  onBrushChange,
  className,
}: {
  days: ActivityDay[];
  brush: Brush | null;
  onBrushChange: (brush: Brush | null) => void;
  className?: string;
}) => {
  const strip = useRef<HTMLDivElement>(null);
  const anchor = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const columnAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.min(days.length - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * days.length)));
  };

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const column = columnAt(event.clientX);
    const nearEdge = brush && (Math.abs(column - brush.from) <= 1 || Math.abs(column - brush.to) <= 1);
    anchor.current = nearEdge
      ? Math.abs(column - brush.from) < Math.abs(column - brush.to)
        ? brush.to
        : brush.from
      : column;
    setDragging(true);
    onBrushChange({ from: Math.min(anchor.current, column), to: Math.max(anchor.current, column) });
  };

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    if (anchor.current === null) return;
    const column = columnAt(event.clientX);
    onBrushChange({ from: Math.min(anchor.current, column), to: Math.max(anchor.current, column) });
  };

  const finish = () => {
    anchor.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") return onBrushChange(null);
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const current = brush ?? { from: days.length - 7, to: days.length - 1 };
    if (event.shiftKey) {
      return onBrushChange({ from: current.from, to: Math.min(days.length - 1, Math.max(current.from, current.to + step)) });
    }
    if (current.from + step < 0 || current.to + step > days.length - 1) return;
    onBrushChange({ from: current.from + step, to: current.to + step });
  };

  const selected = brush ? days.slice(brush.from, brush.to + 1) : days;
  const total = selected.reduce((sum, day) => sum + day.count, 0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(ratio * (days.length - 1)));

  return (
    <section className={cn("@container w-full space-y-4", className)}>
      <header className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-heading font-medium">
          <RollingNumber value={total} className="font-mono" /> Tasks completed
        </h3>
        <p className="text-small text-muted-foreground">One dot is one Task</p>
        {brush ? (
          <button
            type="button"
            onClick={() => onBrushChange(null)}
            className="ml-auto inline-flex h-7 items-center gap-2 rounded-full bg-brand/15 pr-2 pl-3 font-mono text-small text-brand transition-[scale] duration-(--dur-press) ease-out active:scale-[0.96]"
          >
            {days[brush.from]?.label} – {days[brush.to]?.label}
            <X weight="bold" className="size-3" aria-hidden="true" />
            <span className="sr-only">Clear range</span>
          </button>
        ) : (
          <p className="ml-auto text-small text-faint-foreground">Drag across the dots to pick a range</p>
        )}
      </header>
      <div
        ref={strip}
        role="group"
        tabIndex={0}
        aria-label="Activity timeline. Arrow keys move the range, Shift and arrow keys resize it, Escape clears it."
        onPointerDown={begin}
        onPointerMove={track}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={onKeyDown}
        className={cn("relative flex touch-none rounded-lg py-3 select-none", dragging ? "cursor-ew-resize" : "cursor-crosshair")}
      >
        {brush && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 rounded-xl bg-brand/[0.12] before:absolute before:inset-y-4 before:-left-px before:w-[3px] before:rounded-full before:bg-brand after:absolute after:inset-y-4 after:-right-px after:w-[3px] after:rounded-full after:bg-brand"
            style={{
              left: `${(brush.from / days.length) * 100}%`,
              width: `${((brush.to - brush.from + 1) / days.length) * 100}%`,
            }}
          />
        )}
        {days.map((day, index) => {
          const inRange = !brush || (index >= brush.from && index <= brush.to);
          return (
            <span key={day.label} className="relative flex flex-1 flex-col-reverse items-center gap-[2px] @md:gap-[3px] @3xl:gap-1">
              {Array.from({ length: MAX_ROWS }, (_, row) => (
                <span
                  key={row}
                  className={cn(
                    "size-[3px] rounded-full @md:size-[5px] @3xl:size-2 transition-[background-color,opacity] duration-(--dur-fast) ease-out",
                    row < day.count ? (inRange ? "bg-brand" : "bg-brand opacity-30") : "bg-foreground opacity-[0.09]",
                  )}
                />
              ))}
            </span>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-micro text-faint-foreground">
        {ticks.map((index) => (
          <span key={index}>{days[index]?.label}</span>
        ))}
      </div>
    </section>
  );
};

"use client";

import { cn } from "@/lib/utils";

export type CommitmentItem = {
  key: string;
  title: string;
  time: string | null;
  colour: string;
  quiet: boolean;
};

export const calendarInk = (colour: string) => `color-mix(in oklab, ${colour} 78%, var(--foreground))`;

const SIZES = {
  list: { text: "text-body", bar: "h-4", title: "text-foreground" },
  strip: { text: "text-small", bar: "h-3.5", title: "text-muted-foreground" },
} as const;

type Size = keyof typeof SIZES;

const Entry = ({ item, size }: { item: CommitmentItem; size: Size }) => (
  <>
    <span className="sr-only">{item.time === null ? "All day: " : `${item.time}: `}</span>
    {item.time === null ? (
      <span
        aria-hidden="true"
        className={cn("inline-block w-[3px] shrink-0 self-center rounded-full", SIZES[size].bar)}
        style={{ backgroundColor: item.colour }}
      />
    ) : (
      <span aria-hidden="true" className={cn("shrink-0 font-mono tabular-nums", SIZES[size].text)} style={{ color: calendarInk(item.colour) }}>
        {item.time}
      </span>
    )}
    <span className={cn("min-w-0 truncate", SIZES[size].text, item.quiet ? "text-faint-foreground" : SIZES[size].title)}>{item.title}</span>
  </>
);

export const CommitmentList = ({ items, className }: { items: readonly CommitmentItem[]; className?: string }) => (
  <ul aria-label="Calendar" className={cn("flex flex-col gap-0.5", className)}>
    {items.map((item) => (
      <li key={item.key} className="flex min-w-0 items-baseline gap-2 py-0.5">
        <Entry item={item} size="list" />
      </li>
    ))}
  </ul>
);

export const CommitmentStrip = ({ items, free }: { items: readonly CommitmentItem[]; free: string | null }) => (
  <div className="mb-5 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
    {items.length > 0 && (
      <ul aria-label="Calendar today" className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        {items.map((item) => (
          <li key={item.key} className="flex min-w-0 max-w-64 items-baseline gap-1.5">
            <Entry item={item} size="strip" />
          </li>
        ))}
      </ul>
    )}
    {free !== null && (
      <p className="ml-auto shrink-0 text-small text-muted-foreground" title="Free time inside your working hours, after calendar events">
        <span className="font-mono text-foreground tabular-nums">{free}</span> free
      </p>
    )}
  </div>
);

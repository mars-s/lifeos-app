"use client";

import { Archive, CalendarDots, Flag, Moon, Stack, Star, Tray } from "@phosphor-icons/react";
import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { AreaGlyph } from "@/components/lifeos/area-icon";
import { formatMinutes } from "@/components/lifeos/format";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import type { CaptureChipView } from "@/components/lifeos/quick-capture";
import { shortDay, whenLabel } from "../dates";
import type { CaptureChip } from "@lifeos/backend/client/capture-model";

export const WhenGlyph = ({ when, today, className = "size-3.5" }: { when: PlannerTask["when"]; today: string; className?: string }) => {
  if (when.kind === "inbox") return <Tray weight="fill" aria-hidden="true" className={`${className} text-muted-foreground`} />;
  if (when.kind === "anytime") return <Stack weight="fill" aria-hidden="true" className={`${className} text-muted-foreground`} />;
  if (when.kind === "someday") return <Archive weight="fill" aria-hidden="true" className={`${className} text-muted-foreground`} />;
  if (when.date > today) return <CalendarDots weight="fill" aria-hidden="true" className={`${className} text-brand`} />;
  return when.evening ? (
    <Moon weight="fill" aria-hidden="true" className={`${className} text-brand`} />
  ) : (
    <Star weight="fill" aria-hidden="true" className={`${className} text-brand`} />
  );
};

export const chipView = (chip: CaptureChip, today: IsoDate) => {
  switch (chip.field) {
    case "when":
      return { id: chip.token, label: whenLabel(chip.when, today), leading: <WhenGlyph when={chip.when} today={today} /> } satisfies CaptureChipView;
    case "deadline":
      return {
        id: chip.token,
        label: shortDay(chip.deadline),
        tone: "deadline",
        leading: <Flag weight="fill" aria-hidden="true" className="size-3.5" />,
      } satisfies CaptureChipView;
    case "estimate":
      return { id: chip.token, label: formatMinutes(chip.minutes), tone: "figure" } satisfies CaptureChipView;
    case "label":
      return {
        id: chip.token,
        label: chip.name,
        leading: <AreaDot colour={chip.colour} className="size-2" />,
        ...(chip.fresh ? { note: "New Label" } : {}),
      } satisfies CaptureChipView;
    case "list":
      return {
        id: chip.token,
        label: chip.list.title,
        leading:
          chip.list.kind === "area" ? (
            <AreaGlyph colour={chip.list.area.colour} icon={chip.list.area.icon} className="size-3.5" />
          ) : (
            <ProgressPie
              value={chip.list.total === 0 ? 0 : chip.list.done / chip.list.total}
              colour={chip.list.area ? areaVar(chip.list.area.colour) : "var(--muted-foreground)"}
            />
          ),
      } satisfies CaptureChipView;
  }
};

export const destinationOf = (when: PlannerTask["when"], list: { title: string } | undefined, today: string) =>
  list && when.kind === "anytime" ? list.title : whenLabel(when, today);

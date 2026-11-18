import { cn } from "@/lib/utils";

export const AREA_COLOURS = ["violet", "green", "orange", "teal", "rose", "olive", "plum", "slate"] as const;
export type AreaColour = (typeof AREA_COLOURS)[number];

export const areaVar = (colour: AreaColour) => `var(--area-${colour})`;

export const AreaDot = ({ colour, className }: { colour: AreaColour; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn("inline-block size-2 shrink-0 rounded-full", className)}
    style={{ backgroundColor: areaVar(colour) }}
  />
);

import type { AreaColour } from "@lifeos/backend/client/colours";
import { cn } from "@/lib/utils";

export { AREA_COLOURS, type AreaColour } from "@lifeos/backend/client/colours";

export const areaVar = (colour: AreaColour) => `var(--area-${colour})`;

export const AreaDot = ({ colour, className }: { colour: AreaColour; className?: string }) => (
  <span
    aria-hidden="true"
    className={cn("inline-block size-2 shrink-0 rounded-full", className)}
    style={{ backgroundColor: areaVar(colour) }}
  />
);

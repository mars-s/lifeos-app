import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { areaVar, type AreaColour } from "./area";
import { formatMinutes, formatRange } from "./format";

export type PlannedBlock = { id: string; day: string; startMinute: number; minutes: number; done: boolean };

const DAY_MINUTES = 24 * 60;

export const WorkBlockList = ({ blocks, colour = "slate", className }: { blocks: PlannedBlock[]; colour?: AreaColour; className?: string }) => (
  <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
    <span className="w-[3.75rem] text-small text-muted-foreground">Planned</span>
    <ul aria-label="Work Blocks" className="contents">
      {blocks.map((block) => (
        <li
          key={block.id}
          className={cn("flex h-7 max-w-full items-center gap-2 rounded-md pr-2 pl-1 text-small whitespace-nowrap", block.done && "opacity-55")}
          style={{ backgroundColor: `color-mix(in oklab, ${areaVar(colour)} 16%, transparent)` }}
        >
          <span aria-hidden="true" className="h-4 w-[3px] rounded-full" style={{ backgroundColor: areaVar(colour) }} />
          <span>{block.day}</span>
          <span className="font-mono">{formatRange(block.startMinute, (block.startMinute + block.minutes) % DAY_MINUTES)}</span>
          <span className="hidden font-mono text-muted-foreground @xs:inline">{formatMinutes(block.minutes)}</span>
          {block.done && (
            <>
              <Check weight="bold" className="size-3" aria-hidden="true" />
              <span className="sr-only">Done</span>
            </>
          )}
        </li>
      ))}
    </ul>
  </div>
);

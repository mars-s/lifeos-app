import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { areaVar, type AreaColour } from "./area";
import { formatMinutes, formatRange } from "./format";

export type PlannedBlock = { id: string; day: string; startMinute: number; minutes: number; done: boolean; passed?: boolean };

const DAY_MINUTES = 24 * 60;

export const WorkBlocks = ({ blocks, colour = "slate", className }: { blocks: PlannedBlock[]; colour?: AreaColour; className?: string }) => (
  <ul aria-label="Work Blocks" className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
    {blocks.map((block) =>
      block.passed ? (
        <li key={block.id} data-passed className="flex min-h-7 flex-wrap items-center gap-x-1.5 text-small text-muted-foreground">
          <span>Was {block.day}</span>
          <span className="font-mono whitespace-nowrap">{formatRange(block.startMinute, (block.startMinute + block.minutes) % DAY_MINUTES).replace(" – ", "–")}</span>
        </li>
      ) : (
        <li
          key={block.id}
          className={cn("flex h-7 max-w-full items-center gap-2 rounded-md pr-2 pl-1 text-small whitespace-nowrap", block.done && "opacity-55")}
          style={{ backgroundColor: `color-mix(in oklab, ${areaVar(colour)} 16%, transparent)` }}
        >
          <span aria-hidden="true" className="h-4 w-[3px] rounded-full" style={{ backgroundColor: areaVar(colour) }} />
          <span>{block.day}</span>
          <span className="font-mono">{formatRange(block.startMinute, (block.startMinute + block.minutes) % DAY_MINUTES)}</span>
          <span className="hidden font-mono text-muted-foreground @sm:inline">{formatMinutes(block.minutes)}</span>
          {block.done && (
            <>
              <Check weight="bold" className="size-3" aria-hidden="true" />
              <span className="sr-only">Done</span>
            </>
          )}
        </li>
      ),
    )}
  </ul>
);

export const WorkBlockList = ({ blocks, colour, className }: { blocks: PlannedBlock[]; colour?: AreaColour; className?: string }) => (
  <div className={cn("grid grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-x-1.5 @max-xs:grid-cols-1", className)}>
    <span className="text-small leading-7 text-muted-foreground @max-xs:leading-5">Planned</span>
    <WorkBlocks blocks={blocks} colour={colour} />
  </div>
);

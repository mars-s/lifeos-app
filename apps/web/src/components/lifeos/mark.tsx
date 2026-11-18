import { cn } from "@/lib/utils";
import { MARK, markDots } from "./mark-geometry";

export const LifeosMark = ({ className }: { className?: string }) => (
  <svg viewBox={`0 0 ${MARK.box} ${MARK.box}`} aria-hidden="true" className={cn("size-5 shrink-0", className)}>
    {markDots().map((dot) => (
      <circle
        key={`${dot.cx}-${dot.cy}`}
        cx={dot.cx}
        cy={dot.cy}
        r={MARK.radius}
        className={dot.filled ? "fill-brand" : "fill-foreground opacity-[0.16]"}
      />
    ))}
  </svg>
);

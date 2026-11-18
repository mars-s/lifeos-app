import { cn } from "@/lib/utils";
import { MARK, markDots } from "./mark-geometry";

const FILL = {
  rest: "",
  enter: "animate-mark-fill motion-reduce:animate-none",
  loop: "animate-mark-loop motion-reduce:animate-none",
} as const;

const STEP_MS = { rest: 0, enter: 110, loop: 120 } as const;

export const LifeosMark = ({ fill = "rest", className }: { fill?: keyof typeof FILL; className?: string }) => (
  <svg viewBox={`0 0 ${MARK.box} ${MARK.box}`} aria-hidden="true" className={cn("size-5 shrink-0", className)}>
    {markDots().map((dot, index) => (
      <g key={`${dot.cx}-${dot.cy}`}>
        <circle cx={dot.cx} cy={dot.cy} r={MARK.radius} className="fill-foreground opacity-[0.16]" />
        {(dot.filled || fill === "loop") && (
          <circle
            cx={dot.cx}
            cy={dot.cy}
            r={MARK.radius}
            className={cn("fill-brand [transform-box:fill-box] origin-center", FILL[fill], fill === "loop" && !dot.filled && "motion-reduce:hidden")}
            style={{ animationDelay: `${index * STEP_MS[fill]}ms` }}
          />
        )}
      </g>
    ))}
  </svg>
);

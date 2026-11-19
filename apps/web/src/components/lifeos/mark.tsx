import { cn } from "@/lib/utils";
import { MARK, markDots } from "./mark-geometry";

const POP = "animate-mark-fill motion-reduce:animate-none";
const ARRIVE_PRESS_STEP_MS = 40;
const ARRIVE_FILL_AT_MS = 440;
const ARRIVE_FILL_STEP_MS = 110;
const still = () => null;

const FILLS = {
  rest: { every: false, motion: "", baseDelay: still, brandDelay: still },
  enter: { every: false, motion: POP, baseDelay: still, brandDelay: (index: number) => index * ARRIVE_FILL_STEP_MS },
  loop: { every: true, motion: "animate-mark-loop motion-reduce:animate-none", baseDelay: still, brandDelay: (index: number) => index * 120 },
  arrive: {
    every: false,
    motion: POP,
    baseDelay: (index: number) => index * ARRIVE_PRESS_STEP_MS,
    brandDelay: (index: number) => ARRIVE_FILL_AT_MS + index * ARRIVE_FILL_STEP_MS,
  },
  complete: {
    every: true,
    motion: POP,
    baseDelay: still,
    brandDelay: (index: number) => (index < MARK.filled ? null : (index - MARK.filled) * 70),
  },
} as const;

export type MarkFill = keyof typeof FILLS;

export const MARK_ARRIVE_BEAT_MS = ARRIVE_FILL_AT_MS + (MARK.filled - 1) * ARRIVE_FILL_STEP_MS;

const SPRING_ORIGIN = "[transform-box:fill-box] origin-center";

export const LifeosMark = ({ fill = "rest", className }: { fill?: MarkFill; className?: string }) => {
  const { every, motion, baseDelay, brandDelay } = FILLS[fill];
  return (
    <svg viewBox={`0 0 ${MARK.box} ${MARK.box}`} aria-hidden="true" className={cn("size-5 shrink-0", className)}>
      {markDots().map((dot, index) => {
        const pressAt = baseDelay(index);
        const fillAt = brandDelay(index);
        return (
          <g key={`${dot.cx}-${dot.cy}`}>
            <g className={cn(SPRING_ORIGIN, pressAt !== null && motion)} style={pressAt === null ? undefined : { animationDelay: `${pressAt}ms` }}>
              <circle cx={dot.cx} cy={dot.cy} r={MARK.radius} className="fill-foreground opacity-[0.16]" />
            </g>
            {(dot.filled || every) && (
              <circle
                cx={dot.cx}
                cy={dot.cy}
                r={MARK.radius}
                className={cn("fill-brand", SPRING_ORIGIN, fillAt !== null && motion, fill === "loop" && !dot.filled && "motion-reduce:hidden")}
                style={fillAt === null ? undefined : { animationDelay: `${fillAt}ms` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
};

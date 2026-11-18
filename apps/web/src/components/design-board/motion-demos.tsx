"use client";

import { Minus, Play, Plus } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { RollingNumber } from "@/components/ui/rolling-number";
import { formatMinutes, round } from "@/components/lifeos/format";
import { TaskCheckbox } from "@/components/lifeos/task-row";
import { EASE_DRAWER, EASE_IN_OUT, EASE_OUT, instant, spring, springLift, springSettle } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { Specimen } from "./specimen";

const SPRINGS = [
  { name: "spring", spec: "0.30 s, no bounce", use: "Default for anything that moves", config: spring },
  { name: "springLift", spec: "0.28 s, bounce 0.12", use: "Picking something up", config: springLift },
  { name: "springSettle", spec: "0.45 s, bounce 0.22", use: "Dropping it into place", config: springSettle },
];

const CURVES = [
  { name: "ease-out", points: EASE_OUT, use: "Enter and exit" },
  { name: "ease-in-out", points: EASE_IN_OUT, use: "Moving on screen" },
  { name: "ease-drawer", points: EASE_DRAWER, use: "Sheets and drawers" },
];

const DURATIONS = [
  { name: "dur-press", ms: 120, use: "Press feedback" },
  { name: "dur-fast", ms: 160, use: "Hover, tone change" },
  { name: "dur-base", ms: 220, use: "Popovers, fills" },
  { name: "dur-slow", ms: 320, use: "Strike, check draw" },
  { name: "dur-roll", ms: 600, use: "Odometer digits, rings" },
  { name: "dur-linger", ms: 1100, use: "A finished Task lingers" },
];

const bezier = (t: number, p1: number, p2: number) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;

const CurvePlot = ({ points, played }: { points: readonly [number, number, number, number]; played: boolean }) => {
  const [x1, y1, x2, y2] = points;
  return (
    <div className="space-y-2">
      <svg viewBox="0 0 100 56" aria-hidden="true" className="w-full overflow-visible">
        {Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          return <circle key={index} cx={round(bezier(t, x1, x2) * 100)} cy={round(54 - bezier(t, y1, y2) * 52)} r={1.4} className="fill-brand" />;
        })}
      </svg>
      <div className="h-2 rounded-full bg-foreground/[0.06]">
        <div
          className="transition-transform duration-[900ms] motion-reduce:duration-0"
          style={{
            transform: played ? "translateX(calc(100% - 8px))" : "translateX(0)",
            transitionTimingFunction: `cubic-bezier(${points.join(",")})`,
          }}
        >
          <span className="block size-2 rounded-full bg-foreground" />
        </div>
      </div>
    </div>
  );
};

export const MotionSpecimens = () => {
  const reduce = useReducedMotion();
  const [checked, setChecked] = useState(false);
  const [sent, setSent] = useState(false);
  const [played, setPlayed] = useState(false);
  const [tasks, setTasks] = useState(7);

  return (
    <>
      <Specimen
        name="Press"
        note="Everything pressable answers on pointer down: it sinks 3%, and springs back on release. The fill on a checkbox grows from the centre and the tick draws after it."
        className="md:col-span-3 xl:col-span-4"
        stage="gap-6"
      >
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" size="md">
            Plan the day
          </Button>
          <Button size="md">Add Task</Button>
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-small text-muted-foreground select-none">
          <TaskCheckbox checked={checked} onCheckedChange={setChecked} label="Try the completion fill" />
          Tick me, then untick
        </label>
      </Specimen>
      <Specimen
        name="Springs"
        note="Three presets. Bounce only appears when your hand gave the thing momentum: a lift or a drop. Everything else is critically damped."
        className="md:col-span-3 xl:col-span-4"
        stage="items-stretch gap-4"
        aside={
          <Button variant="quiet" icon={Play} onClick={() => setSent(!sent)}>
            {sent ? "Send back" : "Send"}
          </Button>
        }
      >
        {SPRINGS.map((preset) => (
          <div key={preset.name} className="space-y-1.5">
            <p className="flex items-baseline justify-between gap-3 text-small">
              <span className="font-mono">{preset.name}</span>
              <span className="text-right text-muted-foreground">{preset.use}</span>
            </p>
            <div className={cn("flex h-7 items-center rounded-full bg-foreground/[0.05] px-1", sent ? "justify-end" : "justify-start")}>
              <motion.span layout transition={reduce ? instant : preset.config} className="block size-5 rounded-full bg-brand" />
            </div>
            <p className="font-mono text-micro text-faint-foreground">{preset.spec}</p>
          </div>
        ))}
      </Specimen>
      <Specimen
        name="Odometer"
        note="Counts and totals roll digit by digit, rightmost first, so a change is noticed without being announced."
        className="md:col-span-6 xl:col-span-4"
        stage="gap-5"
      >
        <div className="flex items-end gap-8">
          <p>
            <RollingNumber value={tasks} className="font-mono text-display font-medium" />
            <span className="block text-small text-muted-foreground">Tasks today</span>
          </p>
          <p>
            <RollingNumber value={formatMinutes(tasks * 35)} className="font-mono text-display font-medium" />
            <span className="block text-small text-muted-foreground">Planned</span>
          </p>
        </div>
        <div className="flex gap-1.5">
          <IconButton variant="secondary" icon={Minus} iconWeight="bold" label="Remove a Task" onClick={() => setTasks(Math.max(0, tasks - 1))} />
          <IconButton variant="secondary" icon={Plus} iconWeight="bold" label="Add a Task" onClick={() => setTasks(Math.min(19, tasks + 1))} />
        </div>
      </Specimen>
      <Specimen
        name="Easing"
        note="Three curves, each drawn as the path it takes. Nothing in the app eases in: the first frame always moves."
        className="md:col-span-6 xl:col-span-7"
        stage="items-stretch"
        aside={
          <Button variant="quiet" icon={Play} onClick={() => setPlayed(!played)}>
            {played ? "Reset" : "Play"}
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-3 @md:gap-6">
          {CURVES.map((curve) => (
            <div key={curve.name} className="space-y-3">
              <CurvePlot points={curve.points} played={played} />
              <p className="text-micro @md:text-small">
                <span className="block font-mono">{curve.name}</span>
                <span className="block text-muted-foreground">{curve.use}</span>
              </p>
            </div>
          ))}
        </div>
      </Specimen>
      <Specimen
        name="Durations"
        note="Interface motion stays under a third of a second. The two long ones are deliberate: digits rolling, and a finished Task lingering."
        className="md:col-span-6 xl:col-span-5"
        stage="items-stretch justify-start"
      >
        <ul className="w-full space-y-2.5">
          {DURATIONS.map((duration) => (
            <li key={duration.name} className="grid grid-cols-[5.5rem_1fr_2.75rem] items-center gap-3 text-small">
              <span className="font-mono">{duration.name}</span>
              <span className="min-w-0">
                <span className="block h-1.5 rounded-full bg-brand" style={{ width: `${(duration.ms / 1100) * 100}%` }} />
                <span className="mt-1 block truncate text-muted-foreground">{duration.use}</span>
              </span>
              <span className="text-right font-mono text-muted-foreground">{duration.ms}</span>
            </li>
          ))}
        </ul>
      </Specimen>
    </>
  );
};

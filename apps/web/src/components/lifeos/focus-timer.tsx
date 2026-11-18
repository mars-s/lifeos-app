"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";
import { MorphText } from "@/components/ui/morph-text";
import { RollingNumber } from "@/components/ui/rolling-number";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { formatCountdown, round } from "./format";

const RING_DOTS = 24;

export const DotRing = ({
  remaining,
  size = 30,
  dot = 1.6,
  litClassName = "fill-brand",
  className,
}: {
  litClassName?: string;
  remaining: number;
  size?: number;
  dot?: number;
  className?: string;
}) => {
  const lit = Math.ceil(Math.min(1, Math.max(0, remaining)) * RING_DOTS);
  const radius = size / 2 - dot - 0.5;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      {Array.from({ length: RING_DOTS }, (_, index) => {
        const angle = (index / RING_DOTS) * Math.PI * 2 - Math.PI / 2;
        const on = index >= RING_DOTS - lit;
        return (
          <circle
            key={index}
            cx={round(size / 2 + Math.cos(angle) * radius)}
            cy={round(size / 2 + Math.sin(angle) * radius)}
            r={dot}
            className={cn(
              "transition-[fill,opacity] duration-(--dur-slow) ease-out",
              on ? litClassName : "fill-current opacity-20",
            )}
          />
        );
      })}
    </svg>
  );
};

export const FocusTimerPill = ({
  title,
  totalSeconds,
  remainingSeconds,
  running,
  onRunningChange,
  onTick,
  className,
}: {
  title: string;
  totalSeconds: number;
  remainingSeconds: number;
  running: boolean;
  onRunningChange: (running: boolean) => void;
  onTick: () => void;
  className?: string;
}) => {
  const done = remainingSeconds <= 0;
  const tick = useEffectEvent(onTick);
  useEffect(() => {
    if (!running || done) return;
    const timer = setInterval(() => tick(), 1000);
    return () => clearInterval(timer);
  }, [running, done]);

  return (
    <div
      role="timer"
      aria-label={`Focus Session on ${title}`}
      className={cn(
        "inline-flex h-12 max-w-full items-center gap-3 rounded-full bg-popover pr-1.5 pl-3 shadow-float",
        className,
      )}
    >
      <DotRing remaining={remainingSeconds / totalSeconds} />
      <MorphText className="min-w-0 truncate text-small text-muted-foreground">{done ? "Session complete" : title}</MorphText>
      <RollingNumber value={formatCountdown(Math.max(0, remainingSeconds))} stagger={0} className="font-mono font-medium" />
      <button
        type="button"
        aria-label={running ? "Pause Focus Session" : "Start Focus Session"}
        disabled={done}
        onClick={() => {
          haptic("toggle");
          onRunningChange(!running);
        }}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-foreground pr-3.5 pl-3 text-small font-medium text-background transition-[scale,opacity] duration-(--dur-press) ease-out active:scale-[0.96] disabled:opacity-40"
      >
        {running ? <Pause weight="fill" className="size-3.5" /> : <Play weight="fill" className="size-3.5" />}
        <MorphText>{running ? "Pause" : "Start"}</MorphText>
      </button>
    </div>
  );
};

export const useFocusSession = (totalSeconds: number, startAt: number) => {
  const [remainingSeconds, setRemainingSeconds] = useState(startAt);
  const [running, setRunning] = useState(true);
  return {
    totalSeconds,
    remainingSeconds,
    running,
    onRunningChange: setRunning,
    onTick: () => setRemainingSeconds((current) => Math.max(0, current - 1)),
    skip: (seconds: number) => setRemainingSeconds((current) => Math.max(0, current - seconds)),
    restart: () => {
      setRemainingSeconds(totalSeconds);
      setRunning(true);
    },
  };
};

"use client";

import { useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
import { ViewTransition, useEffect, useEffectEvent, useRef, useState, type MouseEvent } from "react";
import { LifeosMark, MARK_ARRIVE_BEAT_MS } from "@/components/lifeos/mark";
import { Button } from "@/components/ui/action-button";
import { MorphText } from "@/components/ui/morph-text";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const WORDMARK_AT_MS = 520;
const GREETING_AT_MS = 1350;
const READY_AT_MS = 1650;
const CLOSING_HOLD_MS = 1150;

const BEATS = ["mark", "greeting", "ready"] as const;
type Beat = (typeof BEATS)[number];

const greetingAt = (hour: number) => (hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

const isBareKey = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !["Shift", "Meta", "Control", "Alt", "Tab"].includes(event.key);

const useAnyInput = (live: boolean, act: () => void) => {
  const onInput = useEffectEvent(act);
  useEffect(() => {
    if (!live) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isBareKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onInput();
    };
    const onPointer = () => onInput();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [live]);
};

export const OnboardingMark = ({ fill, className }: { fill?: "rest" | "arrive" | "complete"; className?: string }) => (
  <ViewTransition name="onboarding-mark" share="mark-travel" default="none">
    <span className="inline-flex">
      <LifeosMark fill={fill} className={className} />
    </span>
  </ViewTransition>
);

const RISE = "transition-[opacity,translate] duration-(--dur-slow) ease-out motion-reduce:transition-opacity";
const HIDDEN = "translate-y-1.5 opacity-0 motion-reduce:translate-y-0";

export const Welcome = ({ start }: { start: (event: MouseEvent) => void }) => {
  const reduced = useReducedMotion();
  const [beat, setBeat] = useState<Beat>(reduced ? "ready" : "mark");
  const [greeting] = useState(() => `${greetingAt(new Date().getHours())}, Avi`);
  const button = useRef<HTMLButtonElement>(null);
  const ready = beat === "ready";

  useEffect(() => {
    if (reduced) return;
    const timers = [
      setTimeout(haptic, MARK_ARRIVE_BEAT_MS, "snap"),
      setTimeout(setBeat, GREETING_AT_MS, "greeting"),
      setTimeout(setBeat, READY_AT_MS, "ready"),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  useAnyInput(!ready, () => setBeat("ready"));

  useEffect(() => {
    if (ready) button.current?.focus({ preventScroll: true });
  }, [ready]);

  return (
    <div className="flex w-full max-w-xl flex-col items-center px-6 pb-10 text-center">
      <OnboardingMark fill={ready ? "rest" : "arrive"} className="size-20" />
      <Dialog.Title
        className={cn("mt-8 text-display font-semibold text-balance", !ready && "animate-screen-in")}
        style={ready ? undefined : { animationDelay: `${WORDMARK_AT_MS}ms` }}
      >
        <MorphText>{beat === "mark" ? "LifeOS" : greeting}</MorphText>
      </Dialog.Title>
      <Dialog.Description className={cn("mt-3 max-w-sm text-body text-pretty text-muted-foreground", RISE, !ready && HIDDEN)}>
        A few short steps to set up this Mac. Skip any of them and change your mind later in Settings.
      </Dialog.Description>
      <div inert={!ready} className={cn("mt-8 flex min-h-9 delay-75", RISE, !ready && HIDDEN)}>
        <Button ref={button} variant="primary" size="md" onClick={start}>
          Get started
        </Button>
      </div>
    </div>
  );
};

export const Closing = ({ leave }: { leave: () => void }) => {
  const onLeave = useEffectEvent(leave);
  useEffect(() => {
    const timer = setTimeout(onLeave, CLOSING_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);
  useAnyInput(true, leave);
  return (
    <div className="flex w-full max-w-xl flex-col items-center px-6 pb-10 text-center">
      <OnboardingMark fill="complete" className="size-20" />
      <Dialog.Title className="mt-8 text-display font-semibold text-balance">You’re set</Dialog.Title>
      <Dialog.Description className="mt-3 text-body text-muted-foreground">Here is your day.</Dialog.Description>
    </div>
  );
};

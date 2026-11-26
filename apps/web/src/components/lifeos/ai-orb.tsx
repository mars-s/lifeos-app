"use client";

import type { IconWeight } from "@phosphor-icons/react";
import { MODE_FRAMES, ThinkingOrb, type ModeFrame, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";

export type AiState = "idle" | "reading" | "writing" | "needsYou" | "done" | "offline";

const RESTING: ModeFrame = (size, _t, opts) => MODE_FRAMES.morph(size, 1, opts);

const LOOKS: Record<AiState, { orb: OrbState; frame?: ModeFrame; label: string; tone?: string }> = {
  idle: { orb: "shaping", frame: RESTING, label: "LifeOS AI" },
  reading: { orb: "searching", label: "Reading" },
  writing: { orb: "composing", label: "Writing" },
  needsYou: { orb: "listening", label: "Needs you" },
  done: { orb: "shaping", frame: RESTING, label: "Done" },
  offline: { orb: "shaping", frame: RESTING, label: "Offline", tone: "opacity-40" },
};

export type AiOrbProps = {
  state?: AiState;
  weight?: IconWeight;
  className?: string;
  "aria-hidden"?: React.AriaAttributes["aria-hidden"];
  "aria-label"?: string;
};

export const AiOrb = ({ state = "idle", weight, className, "aria-hidden": hidden, "aria-label": label }: AiOrbProps) => {
  const look = LOOKS[state];
  return (
    <span aria-hidden={hidden} className={cn("inline-block size-4 shrink-0", look.tone, className)}>
      <ThinkingOrb
        state={look.orb}
        size={20}
        paused={look.frame !== undefined}
        frame={look.frame}
        dotSize={weight === "bold" || weight === "fill" ? 1.25 : 1}
        aria-label={label ?? look.label}
        style={{ width: "100%", height: "100%" }}
      />
    </span>
  );
};

export const AiMark = (props: Omit<AiOrbProps, "state">) => <AiOrb {...props} state="idle" />;
export const AiMarkWorking = (props: Omit<AiOrbProps, "state">) => <AiOrb {...props} state="reading" />;

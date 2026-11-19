"use client";

import type { ShaderController, SweepHandle } from "glimm";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const ENDS = ["#3B7BE8", "#8FD3F4"] as const;
const DRIFT = { sweepMs: 2600, outroMs: 400, peakAlpha: 0.38, easing: "easeInOutCubic", rippleAmount: 0.6 } as const;
const REVEAL = { sweepMs: 900, outroMs: 260, peakAlpha: 0.7, easing: "easeOutQuart", rippleAmount: 0.6 } as const;
const REST_MS = 500;

export const GlimmBand = ({ working, reveal, className }: { working: boolean; reveal: boolean; className?: string }) => {
  const reduce = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const shader = useRef<ShaderController | null>(null);

  useEffect(
    () => () => {
      shader.current?.destroy();
      shader.current = null;
    },
    [],
  );

  useEffect(() => {
    if (reduce || (!working && !shader.current)) return;
    let live = true;
    let sweep: SweepHandle | undefined;
    let rest: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const glimm = await import("glimm");
      if (!live || !canvas.current) return;
      if (working) shader.current ??= glimm.createShader({ canvas: canvas.current, palette: glimm.accentPair(...ENDS), bandTight: 22 });
      const band = shader.current;
      if (!band) return;
      if (!working) {
        if (reveal) sweep = glimm.playSweep(band, REVEAL);
        else band.setAlpha(0);
        return;
      }
      const drift = () => {
        sweep = glimm.playSweep(band, {
          ...DRIFT,
          onComplete: () => {
            if (live) rest = setTimeout(drift, REST_MS);
          },
        });
      };
      drift();
    };
    void run();
    return () => {
      live = false;
      sweep?.cancel();
      clearTimeout(rest);
    };
  }, [working, reveal, reduce]);

  return <canvas ref={canvas} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
};

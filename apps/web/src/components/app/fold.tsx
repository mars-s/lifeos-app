"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { enter, exit, instant, spring, springLayout } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";

const FOLDED = { height: 0, opacity: 0, overflow: "hidden" };
const UNFOLDED = { height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } };
const FADED = { opacity: 0 };
const LIT = { opacity: 1 };

export const Folding = ({ children, appear = true, className }: { children: ReactNode; appear?: boolean; className?: string }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={appear ? (reduce ? FADED : FOLDED) : false}
      animate={reduce ? LIT : UNFOLDED}
      exit={{ ...(reduce ? FADED : FOLDED), transition: reduce ? exit : spring }}
      transition={reduce ? enter : springLayout}
      className={cn("-mx-3 flow-root px-3", className)}
    >
      {children}
    </motion.div>
  );
};

export const Fold = ({ show, children, appear, className }: { show: boolean; children: ReactNode; appear?: boolean; className?: string }) => (
  <AnimatePresence initial={false}>
    {show && (
      <Folding appear={appear} className={className}>
        {children}
      </Folding>
    )}
  </AnimatePresence>
);

export const Arrive = ({ show, children }: { show: boolean; children: ReactNode }) => {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div initial={FADED} animate={{ ...LIT, transition: { ...enter, delay: reduce ? 0 : spring.duration / 2 } }} exit={{ ...FADED, transition: instant }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

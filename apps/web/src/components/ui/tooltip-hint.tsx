"use client";

import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Shared across every tooltip on the page: once one has been open, the next
// one opens instantly instead of waiting out the delay again.
let lastClosedAt = 0;
const WARM_MS = 400;
const GAP = 6;
const EDGE = 8;

export type TooltipProps = {
  content: React.ReactNode;
  /** A single focusable element; it gets aria-describedby pointing at the tooltip. */
  children: React.ReactElement<{ "aria-describedby"?: string; title?: string }>;
  /** The preferred side. It flips when the window has no room there. */
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  /** Hover delay for the first tooltip, in ms. Focus always opens instantly. */
  delay?: number;
  className?: string;
};

type Placement = { style: CSSProperties; side: "top" | "bottom" };

const ORIGIN_X = { start: "left", center: "center", end: "right" } as const;

// Drawn in a portal at a fixed position, so a card with overflow hidden or a
// scroll container can never clip it.
const place = (trigger: DOMRect, bubble: DOMRect, side: "top" | "bottom", align: "start" | "center" | "end"): Placement => {
  const roomAbove = trigger.top - GAP - EDGE;
  const roomBelow = window.innerHeight - trigger.bottom - GAP - EDGE;
  const fits = side === "top" ? bubble.height <= roomAbove : bubble.height <= roomBelow;
  const chosen = fits ? side : roomAbove > roomBelow ? "top" : "bottom";
  const wanted = align === "start" ? trigger.left : align === "end" ? trigger.right - bubble.width : trigger.left + trigger.width / 2 - bubble.width / 2;
  const left = Math.min(Math.max(EDGE, wanted), window.innerWidth - bubble.width - EDGE);
  const top = chosen === "top" ? trigger.top - GAP - bubble.height : trigger.bottom + GAP;
  return { side: chosen, style: { top, left, transformOrigin: `${ORIGIN_X[align]} ${chosen === "top" ? "bottom" : "top"}` } };
};

/** Small hint anchored to its trigger, scaling in from the trigger's side. */
export function Tooltip({ content, children, side = "top", align = "center", delay = 300, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Instant when warm (another tooltip just closed) or opened from the keyboard.
  const [instant, setInstant] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    setPlacement(place(anchor.current.getBoundingClientRect(), bubble.current.getBoundingClientRect(), side, align));
  }, [open, side, align, content]);

  const show = (fromFocus: boolean) => {
    clearTimeout(timer.current);
    const warm = Date.now() - lastClosedAt < WARM_MS;
    if (fromFocus || warm) {
      setInstant(true);
      setOpen(true);
      return;
    }
    setInstant(false);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (open) lastClosedAt = Date.now();
    setOpen(false);
    setPlacement(null);
  };

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide, { passive: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  const trigger = isValidElement(children)
    ? // Drop any native title (IconButton sets one) so the hint doesn't show twice.
      cloneElement(children, {
        "aria-describedby": open ? id : undefined,
        title: undefined,
      })
    : children;

  return (
    <span
      ref={anchor}
      className="relative inline-flex"
      onPointerEnter={(e) => e.pointerType === "mouse" && show(false)}
      onPointerLeave={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && show(true)}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
    >
      {trigger}
      {open &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            role="tooltip"
            data-side={placement?.side}
            style={placement?.style ?? { top: 0, left: 0, visibility: "hidden" }}
            className={cn(
              "pointer-events-none fixed z-[100] w-max max-w-64 rounded-xl bg-popover px-2.5 py-1.5 text-xs text-foreground shadow-float",
              "transition-[opacity,scale] duration-[125ms] ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-[0.97] starting:opacity-0 motion-reduce:starting:scale-100",
              instant && "duration-0",
              className,
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

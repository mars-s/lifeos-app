"use client";

import { TextMorph } from "torph/react";
import { CSS_EASE_OUT } from "@/lib/motion-tokens";

/**
 * A label that changes in place: shared letters slide, the rest fade.
 * Reduced motion swaps instantly. Counting numbers use RollingNumber instead.
 */
export function MorphText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <TextMorph as="span" duration={280} ease={CSS_EASE_OUT} className={className}>
      {children}
    </TextMorph>
  );
}

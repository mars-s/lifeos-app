"use client";

import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export const ToolButton = ({
  icon: IconComponent,
  label,
  active,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { icon: Icon; label: string; active?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    className={cn(
      "group/tool relative inline-flex h-7 shrink-0 items-center rounded-full px-1.5 text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out before:absolute before:-inset-y-2 before:inset-x-0 hover:bg-foreground/[0.06] active:scale-[0.96] aria-expanded:bg-foreground/[0.06]",
      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      className,
    )}
    {...props}
  >
    <IconComponent weight={active ? "fill" : "regular"} className="size-4" aria-hidden="true" />
    {children ?? (
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] @max-xs:hidden duration-(--dur-base) ease-out group-hover/tool:grid-cols-[1fr] group-focus-visible/tool:grid-cols-[1fr] group-aria-expanded/tool:grid-cols-[1fr]">
        <span className="overflow-hidden pl-1.5 whitespace-nowrap">{label}</span>
      </span>
    )}
  </button>
);

export const MenuRow = ({
  selected,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) => (
  <button
    type="button"
    className={cn(
      "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-small transition-colors duration-(--dur-press) hover:bg-foreground/[0.06]",
      selected && "bg-foreground/[0.06] font-medium",
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

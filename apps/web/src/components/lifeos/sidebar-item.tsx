"use client";

import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { cn } from "@/lib/utils";

export const SidebarItem = ({
  icon: IconComponent,
  leading,
  label,
  count,
  active = false,
  indent = false,
  onSelect,
}: {
  icon?: Icon;
  leading?: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  indent?: boolean;
  onSelect?: () => void;
}) => (
  <button
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onSelect}
    className={cn(
      "flex h-8 w-full items-center gap-2.5 rounded-lg pr-2.5 text-left text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
      indent ? "pl-7" : "pl-2.5",
      active ? "bg-foreground/[0.08] font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
    )}
  >
    <span className={cn("grid size-4 shrink-0 place-items-center", active ? "text-brand" : "text-muted-foreground")}>
      {IconComponent ? <IconComponent weight="fill" className="size-4" aria-hidden="true" /> : leading}
    </span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {count !== undefined && count > 0 && (
      <RollingNumber value={count} className="font-mono text-micro text-faint-foreground" />
    )}
  </button>
);

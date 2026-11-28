import type { Glyph } from "@/lib/glyph";
import { cn } from "@/lib/utils";

export const FACT_GRID = "grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-x-3";

export const FactRow = ({
  icon: IconComponent,
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { icon: Glyph; label: string }) => (
  <div className={cn(FACT_GRID, className)} {...props}>
    <span data-fact-glyph title={label} className="grid h-7 place-items-center text-muted-foreground">
      <IconComponent className="size-4" aria-hidden="true" />
    </span>
    <div data-fact-text className="min-w-0">
      {children}
    </div>
  </div>
);

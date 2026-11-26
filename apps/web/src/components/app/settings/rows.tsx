"use client";

import type { Glyph } from "@/lib/glyph";
import { useId, type ReactNode } from "react";
import { Switch } from "@/components/ui/choice-controls";
import { MorphText } from "@/components/ui/morph-text";
import { cn } from "@/lib/utils";

export const SettingsGroup = ({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) => {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="mt-9 first:mt-0">
      <h2 id={heading} className="px-1 text-heading font-medium">
        {title}
      </h2>
      {hint && <p className="px-1 pt-0.5 text-small text-pretty text-muted-foreground">{hint}</p>}
      <div className="mt-2.5 rounded-xl bg-foreground/[0.035] [&>*+*]:border-t [&>*+*]:border-foreground/[0.06]">{children}</div>
    </section>
  );
};

export const SettingsRow = ({
  icon: IconComponent,
  label,
  hint,
  children,
  below,
}: {
  icon: Glyph;
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  below?: ReactNode;
}) => (
  <div className="px-3.5 py-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-foreground/[0.06] text-muted-foreground">
        <IconComponent weight="fill" className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-[11rem] flex-1">
        <div className="text-small font-medium">{label}</div>
        {hint && <div className="text-small text-pretty text-muted-foreground">{hint}</div>}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-3 pl-11">{children}</div>}
    </div>
    {below && <div className="pt-2.5 pl-11">{below}</div>}
  </div>
);

export const FeatureRow = ({
  icon,
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  below,
}: {
  icon: Glyph;
  label: string;
  hint: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  below?: ReactNode;
}) => (
  <SettingsRow icon={icon} label={label} hint={hint} below={below}>
    <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
  </SettingsRow>
);

export type LampTone = "positive" | "negative" | "quiet";

const LAMP = {
  positive: "bg-positive",
  negative: "bg-negative",
  quiet: "bg-foreground/25",
} as const satisfies Record<LampTone, string>;

export const StatusLamp = ({ tone, children, className }: { tone: LampTone; children: string; className?: string }) => (
  <span role="status" className={cn("flex items-center gap-2 text-small whitespace-nowrap text-muted-foreground", className)}>
    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full transition-[background-color] duration-(--dur-base) ease-out", LAMP[tone])} />
    <MorphText>{children}</MorphText>
  </span>
);

export const Problem = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="text-small text-pretty text-negative">
    {children}
  </p>
);

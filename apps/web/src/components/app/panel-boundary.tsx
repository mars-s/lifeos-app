"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { Component, type ReactNode } from "react";
import { isAccessError } from "@/components/owner-gate";
import { EmptyState } from "@/components/lifeos/states";
import { cn } from "@/lib/utils";

type Variant = "screen" | "panel" | "inline";

const COPY = {
  list: { title: "This list did not load", hint: "Everything else still works. Try again in a moment." },
  sidebar: { title: "Your lists did not load", hint: "The page you are on still works." },
  card: { title: "This Task did not open", hint: "Your other Tasks are fine." },
  bar: { title: "The selection bar did not load", hint: "Right-click the selection for the same actions." },
  picker: { title: "This picker did not load", hint: "Close it and open it again." },
} as const;

export type PanelName = keyof typeof COPY;

const retryClass =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-3.5 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97]";

export const PanelNotice = ({ panel, variant, onRetry }: { panel: PanelName; variant: Variant; onRetry: () => void }) => {
  const { title, hint } = COPY[panel];
  const retry = (
    <button type="button" onClick={onRetry} className={cn(retryClass, variant !== "screen" && "h-7 px-3")}>
      <ArrowClockwise weight="bold" className="size-3.5" aria-hidden="true" />
      Try Again
    </button>
  );
  if (variant === "screen")
    return (
      <div role="alert">
        <EmptyState title={title} hint={hint} action={retry} className="py-16" />
      </div>
    );
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 text-small", variant === "panel" ? "px-2.5 py-3" : "py-2 pr-3 pl-[2.625rem]")}>
      <p className="text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">{title}.</span> {hint}
      </p>
      {retry}
    </div>
  );
};

type Props = {
  panel: PanelName;
  variant?: Variant;
  fallback?: (retry: () => void) => ReactNode;
  children: ReactNode;
};

export class PanelBoundary extends Component<Props, { error: unknown; failed: boolean }> {
  override state = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  retry = () => this.setState({ error: null, failed: false });

  override render() {
    const { error, failed } = this.state as { error: unknown; failed: boolean };
    if (!failed) return this.props.children;
    if (isAccessError(error)) throw error;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return <PanelNotice panel={this.props.panel} variant={this.props.variant ?? "panel"} onRetry={this.retry} />;
  }
}

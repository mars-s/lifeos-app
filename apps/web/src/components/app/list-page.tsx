"use client";

import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/lifeos/states";
import { cn } from "@/lib/utils";
import { routeHref, type Route } from "./route";
import { useShell } from "./shell-context";

export const ListPage = ({
  title,
  icon: IconComponent,
  leading,
  subtitle,
  aside,
  children,
}: {
  title?: string;
  icon?: Icon;
  leading?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) => (
  <article className="mx-auto w-full max-w-[44rem] px-5 pt-4 pb-28 md:px-10 md:pt-14">
    <title>{title ? `${title} · LifeOS` : "LifeOS"}</title>
    <header className={cn("mb-6 flex gap-3", IconComponent ? "items-start" : "items-center")}>
      {IconComponent ? <IconComponent weight="fill" className="mt-0.5 size-6 shrink-0 text-brand" aria-hidden="true" /> : leading}
      <div className="min-w-0 flex-1">
        {title ? (
          <h1 className="text-title font-semibold text-balance">{title}</h1>
        ) : (
          <span className="block h-7 w-40 animate-delayed-in rounded-full bg-foreground/[0.06]" />
        )}
        {subtitle && <div className="mt-0.5 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">{subtitle}</div>}
      </div>
      {aside}
    </header>
    {children}
  </article>
);

export const SectionHeading = ({
  children,
  leading,
  aside,
  className,
}: {
  children: ReactNode;
  leading?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) => (
  <h2 className={cn("mt-8 mb-1 flex h-9 items-center gap-2 border-b border-border text-heading font-medium", className)}>
    {leading}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {aside}
  </h2>
);

export const RouteLink = ({ to, className, children, ...props }: { to: Route } & Omit<React.ComponentProps<"a">, "href">) => {
  const { navigate } = useShell();
  return (
    <a
      {...props}
      href={routeHref(to)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to, event.detail === 0 ? "keyboard" : "pointer");
      }}
      className={className}
    >
      {children}
    </a>
  );
};

const SKELETON_WIDTHS = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-1/2"];

export const ListSkeleton = () => (
  <div role="status" aria-label="Loading…" className="animate-delayed-in space-y-1 pt-1">
    {SKELETON_WIDTHS.map((width, index) => (
      <div key={index} className="flex h-10 items-center gap-3">
        <span className="size-[18px] rounded-[6px] bg-foreground/[0.06]" />
        <span className={cn("h-3 rounded-full bg-foreground/[0.06]", width)} />
      </div>
    ))}
  </div>
);

export const Missing = () => (
  <ListPage title="Nothing here">
    <EmptyState
      title="This page has gone"
      hint="It was completed or removed in Things."
      action={
        <RouteLink to={{ kind: "today" }} className="rounded-full bg-foreground/[0.06] px-3 py-1.5 text-small font-medium transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.1] active:scale-[0.97]">
          Back to Today
        </RouteLink>
      }
      className="py-16"
    />
  </ListPage>
);

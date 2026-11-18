import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Specimen = ({
  name,
  note,
  children,
  className,
  stage,
  aside,
}: {
  name: string;
  note: string;
  children: ReactNode;
  className?: string;
  stage?: string;
  aside?: ReactNode;
}) => (
  <article className={cn("flex min-w-0 flex-col rounded-[1.375rem] bg-surface p-1.5", className)}>
    <div
      className={cn(
        "flex min-h-52 min-w-0 flex-1 flex-col items-center justify-center rounded-2xl bg-surface-inset p-5 @container sm:p-7",
        stage,
      )}
    >
      {children}
    </div>
    <div className="flex items-start gap-3 px-3 pt-3 pb-2.5">
      <div className="min-w-0 flex-1">
        <h3 className="text-heading font-medium">{name}</h3>
        <p className="text-small text-pretty text-muted-foreground">{note}</p>
      </div>
      {aside}
    </div>
  </article>
);

export const Section = ({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: string;
  children: ReactNode;
}) => (
  <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 pt-20 sm:pt-28">
    <header className="mb-6 max-w-2xl sm:mb-8">
      <h2 id={`${id}-title`} className="text-title font-semibold sm:text-[2rem] sm:leading-9 sm:tracking-[-0.025em]">
        {title}
      </h2>
      <p className="mt-2 text-pretty text-muted-foreground">{lede}</p>
    </header>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6 xl:grid-cols-12">{children}</div>
  </section>
);

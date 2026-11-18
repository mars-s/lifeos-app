"use client";

import { useEffect } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/toast-stack";
import { undoLast } from "@/components/lifeos/undo";
import { HeroToday, PlanningSpecimens, ReviewSpecimens, TaskSpecimens } from "./component-demos";
import { ControlSpecimens } from "./control-demos";
import { ColourSpecimens, SurfaceSpecimens, TypeSpecimens } from "./foundations";
import { MotionSpecimens } from "./motion-demos";
import { Section } from "./specimen";
import { ThemeContext, useTheme } from "./theme";

const SECTIONS = [
  { id: "colour", label: "Colour" },
  { id: "type", label: "Type" },
  { id: "surfaces", label: "Surfaces" },
  { id: "motion", label: "Motion" },
  { id: "controls", label: "Controls" },
  { id: "tasks", label: "Tasks" },
  { id: "planning", label: "Planning" },
  { id: "review", label: "Focus and review" },
];

const PRINCIPLES = [
  { line: "Calm, like paper.", detail: "Layers of tone, generous space, quiet chrome. Nothing shouts." },
  { line: "Every touch answers.", detail: "Within a frame, physically, and it can always be undone." },
  { line: "Time you can see.", detail: "Dots, rings and meters, drawn with care. Never a stock chart." },
];

export const DesignBoard = () => {
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing || event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (undoLast()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <ThemeContext value={theme}>
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-32 sm:px-8 lg:px-12">
        <header className="sticky top-0 z-40 -mx-4 flex h-16 items-center gap-6 bg-background/85 px-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
          <a href="#top" className="flex items-baseline gap-2 rounded-md">
            <span className="text-heading font-semibold">LifeOS</span>
            <span className="text-small text-muted-foreground">Design system</span>
          </a>
          <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 lg:flex">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full px-2.5 py-1 text-small text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-foreground/[0.05] hover:text-foreground"
              >
                {section.label}
              </a>
            ))}
          </nav>
          <Segmented
            label="Theme"
            size="sm"
            className="ml-auto lg:ml-2"
            value={theme}
            onValueChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </header>

        <section id="top" aria-labelledby="principles" className="grid scroll-mt-24 items-start gap-x-16 gap-y-12 pt-10 sm:pt-16 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="xl:pt-10">
            <h1 id="principles" className="sr-only">
              LifeOS design principles
            </h1>
            <ol className="space-y-7 sm:space-y-9">
              {PRINCIPLES.map((principle) => (
                <li key={principle.line}>
                  <p className="text-[2.25rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[3.25rem]">
                    {principle.line}
                  </p>
                  <p className="mt-2 max-w-md text-pretty text-muted-foreground">{principle.detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-10 max-w-md text-small text-pretty text-faint-foreground">
              Everything on this page is live. Tick a Task on the right, then undo it.
            </p>
          </div>
          <HeroToday />
        </section>

        <Section
          id="colour"
          title="Colour"
          lede="Warm paper by day, graphite at night. Tone does the work of borders, one cool accent marks what is selected or allocated, and amber is kept for the Deadline."
        >
          <ColourSpecimens />
        </Section>
        <Section
          id="type"
          title="Type"
          lede="Inter for words, Geist Mono for figures. The split is a rule: if it is a time, an Estimate or a count, it is mono."
        >
          <TypeSpecimens />
        </Section>
        <Section
          id="surfaces"
          title="Surfaces"
          lede="Borderless layers after TuffUI. Shadows are rare, so when one appears it means the thing is in your hand or above the page."
        >
          <SurfaceSpecimens />
        </Section>
        <Section
          id="motion"
          title="Motion"
          lede="Motion is feedback. It starts on the first frame, follows your hand, and gets out of the way. With reduced motion on, movement becomes a short fade."
        >
          <MotionSpecimens />
        </Section>
        <Section
          id="controls"
          title="Controls"
          lede="The TuffUI foundation pieces, restyled to these tokens. They are the parts every screen is built from."
        >
          <ControlSpecimens />
        </Section>
        <Section
          id="tasks"
          title="Tasks"
          lede="The Things 3 model: a quiet row that opens in place into a card. The Deadline and the allocated time never share a shape or a colour."
        >
          <TaskSpecimens />
        </Section>
        <Section
          id="planning"
          title="Planning"
          lede="A day has a Capacity. Tasks fill it as dots, and Work Blocks claim real slots on the calendar."
        >
          <PlanningSpecimens />
        </Section>
        <Section
          id="review"
          title="Focus and review"
          lede="Where the personality lives. Time spent is drawn as dots you can read at a glance and brush with a finger."
        >
          <ReviewSpecimens />
        </Section>
      </div>
      <Toaster />
    </ThemeContext>
  );
};

"use client";

import { useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { LifeosMark } from "@/components/lifeos/mark";
import { Section, Specimen } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { ControlCentre, HomeScreen, InlineAccessory, IslandCompact, IslandExpanded, IslandMinimal, LockScreen, StandBy, TodayCircle, CapacityCircle, BrainDumpCircle, NextUpRectangle } from "./iphone";
import { MacDesktop } from "./mac";
import type { Mode } from "./model";
import { CapacityDots, DayStrip, DotNumber, FocusStrip, MODE_VARS, Wall, WeekColumns } from "./parts";
import { CAPACITY, FOCUS, NOW, SPANS, TODAY_SLICES, WEEK, WORKING } from "./sample";
import {
  CapacityWidget,
  DoneWidget,
  FocusWidget,
  FreeWidget,
  NextUpWidget,
  PlaceholderWidget,
  StaleWidget,
  TodayWidget,
  UpcomingWidget,
  WeekWidget,
  WorldProvider,
} from "./tiles";

const SECTIONS = [
  { id: "anatomy", label: "Anatomy" },
  { id: "iphone", label: "iPhone" },
  { id: "modes", label: "Modes" },
  { id: "lock", label: "Lock Screen" },
  { id: "mac", label: "Mac" },
  { id: "states", label: "States" },
];

const PRINCIPLES = [
  { line: "One figure each.", detail: "A widget answers one question with one number you can read from across the room." },
  { line: "Drawn like a gauge.", detail: "A title, a one-word state, a dot-matrix figure, a unit, and an analog strip at the foot. The same parts at every size." },
  { line: "Still until a clock runs.", detail: "Nothing moves on the Home Screen. Only a Focus Session counts down, and only a Task’s box can be pressed." },
];

const BLEND = [
  {
    from: "From the reference",
    items: ["A big dot-matrix figure", "A small title over a one-word state", "A tiny unit badge on the right", "A thin strip at the foot with a time axis"],
  },
  {
    from: "From LifeOS",
    items: ["Warm paper in light, graphite in dark", "Geist Mono for every time and count", "One dot is 15 minutes, as in the Planner", "Area colours as dots, amber only for a Deadline"],
  },
];

const PARTS = [
  { name: "Title and state", detail: "What it measures, and one word for how it is going: roomy, steady, tight, full or over." },
  { name: "Figure", detail: "Dots on a 5 by 7 grid. Times are always h:mm, like an Estimate." },
  { name: "Unit badge", detail: "A glyph and the unit, so the figure never needs a label beside it." },
  { name: "Strip", detail: "The analog reading of the same fact. Here, the working day with its Work Blocks and a line for now." },
  { name: "Axis", detail: "Two mono labels at the ends. Never more than two." },
];

const MARKS: { part: number; className: string }[] = [
  { part: 1, className: "top-[1.625rem] -left-3" },
  { part: 2, className: "top-[10.75rem] -left-3" },
  { part: 3, className: "top-[10.75rem] -right-3" },
  { part: 4, className: "top-[15.75rem] -left-3" },
  { part: 5, className: "top-[17.875rem] -right-3" },
];

const Mark = ({ part, className }: { part: number; className?: string }) => (
  <span className={`grid size-5 place-items-center rounded-full bg-foreground font-mono text-micro font-medium text-background ${className ?? ""}`}>{part}</span>
);

const Swatch = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col items-center gap-3">
    {children}
    <p className="text-small text-muted-foreground">{name}</p>
  </div>
);

const StripRow = ({ name, detail, children }: { name: string; detail: string; children: ReactNode }) => (
  <div className="grid items-center gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
    <div>
      <p className="text-small font-medium">{name}</p>
      <p className="text-micro text-pretty text-muted-foreground">{detail}</p>
    </div>
    <div className="min-w-0 text-(--w-ink)" style={MODE_VARS.colour}>
      {children}
    </div>
  </div>
);

const MODES: { mode: Extract<Mode, "colour" | "tinted" | "clear">; tone?: "light" | "dark"; name: string }[] = [
  { mode: "colour", tone: "light", name: "Light" },
  { mode: "colour", tone: "dark", name: "Dark" },
  { mode: "tinted", name: "Tinted" },
  { mode: "clear", name: "Clear" },
];

export const WidgetsBoard = () => {
  const [theme, setTheme] = useTheme();
  const [home, setHome] = useState<Extract<Mode, "colour" | "tinted" | "clear">>("colour");
  const [front, setFront] = useState<"desktop" | "front">("desktop");
  return (
    <ThemeContext value={theme}>
      <WorldProvider>
        <div className="mx-auto w-full max-w-[90rem] px-4 pb-32 sm:px-8 lg:px-12">
          <header className="sticky top-0 z-40 -mx-4 flex h-16 items-center gap-6 bg-background/85 px-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
            <a href="/design" className="flex items-center gap-2 rounded-md">
              <LifeosMark />
              <span className="text-heading font-semibold">LifeOS</span>
              <span className="text-small text-muted-foreground">Widgets</span>
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

          <section aria-labelledby="direction" className="grid items-start gap-x-16 gap-y-10 pt-10 sm:pt-16 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
            <div>
              <h1 id="direction" className="sr-only">
                LifeOS widgets design direction
              </h1>
              <ol className="space-y-6 sm:space-y-8">
                {PRINCIPLES.map((principle) => (
                  <li key={principle.line}>
                    <p className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[2.75rem]">{principle.line}</p>
                    <p className="mt-2 max-w-md text-pretty text-muted-foreground">{principle.detail}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:pt-3">
              {BLEND.map((side) => (
                <div key={side.from} className="rounded-[1.375rem] bg-surface p-5">
                  <h2 className="text-heading font-medium">{side.from}</h2>
                  <ul className="mt-3 space-y-2.5 text-small text-muted-foreground">
                    {side.items.map((item) => (
                      <li key={item} className="flex gap-2.5 text-pretty">
                        <span aria-hidden="true" className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-foreground/25" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <Section id="anatomy" title="Anatomy" lede="Every widget is the same instrument. Five parts, always in the same place, so the eye learns where the number is.">
            <Specimen
              name="The tile"
              note="Capacity at twice its size. Capacity is the free time in Working Hours, less what is planned."
              className="md:col-span-6 xl:col-span-7"
              stage="p-0 sm:p-0"
            >
              <div className="grid w-full flex-1 items-center gap-8 p-5 sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)]">
                <Wall width={376} className="max-w-[26rem] justify-self-center">
                  <div className="relative mx-auto my-2 w-[20.5rem]">
                    <div style={{ zoom: 2 }}>
                      <CapacityWidget />
                    </div>
                    {MARKS.map((mark) => (
                      <Mark key={mark.part} part={mark.part} className={`absolute ${mark.className}`} />
                    ))}
                  </div>
                </Wall>
                <ol className="space-y-3.5">
                  {PARTS.map((part, index) => (
                    <li key={part.name} className="flex gap-3">
                      <Mark part={index + 1} className="mt-0.5 shrink-0" />
                      <span>
                        <span className="block text-small font-medium">{part.name}</span>
                        <span className="block text-small text-pretty text-muted-foreground">{part.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Specimen>
            <Specimen
              name="Figures"
              note="Eleven glyphs: the digits and a colon. Drawn as shapes for snapshots, and built into a small font for the live countdown."
              className="md:col-span-6 xl:col-span-5"
            >
              <div className="flex flex-col items-center gap-7">
                <DotNumber value="01234" pitch={8} />
                <DotNumber value="56789" pitch={8} />
                <DotNumber value="18:42" pitch={8} />
              </div>
            </Specimen>
            <Specimen
              name="Strips"
              note="Four strips cover every widget. Each is a row of plain shapes, so it draws the same in a snapshot, in one tint, or on the Lock Screen."
              className="col-span-full"
              stage="items-stretch"
            >
              <div className="mx-auto w-full max-w-3xl space-y-7">
                <StripRow name="Day strip" detail="A tick each half hour. Solid is a Work Block, outlined is an External Commitment, hatched is a Trip, the line is now.">
                  <DayStrip start={WORKING.start} end={WORKING.end} now={NOW} spans={SPANS} />
                </StripRow>
                <StripRow name="Capacity dots" detail="One dot is 15 minutes, grouped by the hour and filled in Area colours.">
                  <CapacityDots slices={TODAY_SLICES} capacity={CAPACITY} dot={7} />
                </StripRow>
                <StripRow name="Week columns" detail="A dot is an hour planned over the hours free. A diamond is a Deadline.">
                  <WeekColumns days={WEEK} className="max-w-[16rem]" />
                </StripRow>
                <StripRow name="Focus ticks" detail="One tick a minute of the Focus Session. The done ones stand tall.">
                  <FocusStrip total={FOCUS.planned} elapsed={FOCUS.elapsed} className="max-w-[16rem]" />
                </StripRow>
              </div>
            </Specimen>
          </Section>

          <Section
            id="iphone"
            title="iPhone"
            lede="Five widgets earn a place. Today, Capacity and Next up live on the Home Screen. Focus appears when a session runs. Upcoming is there for the week ahead."
          >
            <Specimen
              name="Home Screen"
              note="Today across the top, Capacity and Next up under it. Tick a box: it is the one thing a widget lets you press."
              className="md:col-span-6 xl:col-span-5"
              aside={
                <Segmented
                  label="Home Screen appearance"
                  size="sm"
                  value={home}
                  onValueChange={setHome}
                  options={[
                    { value: "colour", label: "Colour" },
                    { value: "tinted", label: "Tinted" },
                    { value: "clear", label: "Clear" },
                  ]}
                />
              }
            >
              <HomeScreen mode={home} />
            </Specimen>
            <div className="grid content-start gap-3 md:col-span-6 xl:col-span-7">
              <Specimen name="Small" note="Capacity, Next up and Focus. One figure, one strip. A tap opens the Planner, the Task or the timer." stage="p-0 sm:p-0">
                <Wall width={524}>
                  <div className="flex gap-4">
                    <CapacityWidget />
                    <NextUpWidget />
                    <FocusWidget />
                  </div>
                </Wall>
              </Specimen>
              <Specimen name="Medium" note="Today with the next three Tasks, and Upcoming with a column of dots for each day." stage="p-0 sm:p-0">
                <Wall width={704}>
                  <div className="flex flex-wrap gap-4">
                    <TodayWidget />
                    <UpcomingWidget />
                  </div>
                </Wall>
              </Specimen>
              <Specimen name="Large and medium" note="Today in full: six Tasks, the day strip and the capacity dots. Next up at medium adds the Area, the place and when to leave." stage="p-0 sm:p-0">
                <Wall width={704}>
                  <div className="flex items-start gap-4">
                    <TodayWidget size="large" />
                    <NextUpWidget size="medium" />
                  </div>
                </Wall>
              </Specimen>
            </div>
          </Section>

          <Section
            id="modes"
            title="Modes"
            lede="iOS can strip a widget to one tint or to clear glass. Colour is never the only signal here: Areas become ink, a Deadline keeps its diamond, a Commitment keeps its outline."
          >
            <Specimen
              name="Light, dark, tinted, clear"
              note="The figure and the filled shapes take the accent. Everything else steps down in opacity. The same drawing works in all four."
              className="col-span-full"
              stage="p-3 sm:p-3"
            >
              <div className="grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {MODES.map((entry) => (
                  <Swatch key={entry.name} name={entry.name}>
                    <Wall width={344} tone={entry.tone} mode={entry.mode}>
                      <div className="flex flex-col gap-4">
                        <TodayWidget />
                        <div className="flex justify-between">
                          <CapacityWidget />
                          <NextUpWidget />
                        </div>
                      </div>
                    </Wall>
                  </Swatch>
                ))}
              </div>
            </Specimen>
          </Section>

          <Section
            id="lock"
            title="Lock Screen and beyond"
            lede="The glanceable ones. One vibrant ink, no backgrounds, and the Focus Session as a Live Activity that counts down by itself."
          >
            <div className="grid content-start gap-3 md:col-span-6 xl:col-span-5">
              <Specimen
                name="Lock Screen"
                note="Inline above the clock, Next up as the rectangle, Capacity and Brain Dump as circles. The Live Activity sits at the foot with Pause and Stop."
              >
                <LockScreen />
              </Specimen>
              <Specimen name="Control Centre" note="Two controls: Brain Dump opens capture, Focus starts or stops a session. They also fit the Action button and the Lock Screen corners.">
                <ControlCentre />
              </Specimen>
            </div>
            <div className="grid content-start gap-3 md:col-span-6 xl:col-span-7">
              <Specimen name="Accessories" note="Inline, rectangular and three circles. Brain Dump is a count and a tap that opens capture." stage="p-0 sm:p-0">
                <div className="dark relative isolate flex w-full flex-1 flex-col items-center justify-center gap-6 overflow-hidden rounded-2xl p-6">
                  <BackdropNight />
                  <InlineAccessory />
                  <div className="flex flex-wrap items-center justify-center gap-5">
                    <NextUpRectangle />
                    <CapacityCircle />
                    <BrainDumpCircle />
                    <TodayCircle />
                  </div>
                </div>
              </Specimen>
              <Specimen name="Dynamic Island" note="Minimal, compact and expanded. The ring fills as the session runs, and the time is a live timer." stage="gap-5">
                <div className="flex flex-wrap items-center justify-center gap-5">
                  <IslandMinimal />
                  <IslandCompact />
                </div>
                <IslandExpanded />
              </Specimen>
              <Specimen name="StandBy" note="Two small widgets on black with their backgrounds removed. At night the same drawing turns red." stage="gap-4">
                <StandBy />
                <div className="w-full max-w-[26rem]">
                  <StandBy night />
                </div>
              </Specimen>
            </div>
          </Section>

          <Section
            id="mac"
            title="Mac"
            lede="The same tiles on the desktop, plus an extra large week. When an app comes to the front macOS drains them to one ink, so they must read without colour."
          >
            <Specimen
              name="Desktop"
              note="This week at extra large, Today at large, then Next up, Capacity and Focus. Bring LifeOS to the front to see them fade."
              className="col-span-full"
              stage="p-3 sm:p-3"
              aside={
                <Segmented
                  label="What is in front"
                  size="sm"
                  value={front}
                  onValueChange={setFront}
                  options={[
                    { value: "desktop", label: "Desktop" },
                    { value: "front", label: "App in front" },
                  ]}
                />
              }
            >
              <MacDesktop front={front === "front"} />
            </Specimen>
            <Specimen name="Extra large" note="A column for each day, two dots to the hour, with the planned time under it. Deadlines, three Tasks and the Brain Dump count on the right." className="col-span-full" stage="p-0 sm:p-0">
              <Wall width={704}>
                <WeekWidget />
              </Wall>
            </Specimen>
          </Section>

          <Section id="states" title="States" lede="What a tile shows when the day is done, over, or when the app has not written a fresh snapshot.">
            <Specimen name="Edge cases" note="Clear, over Capacity, nothing booked, a Focus Session ready, paused, a stale snapshot, and the placeholder before the first one." className="col-span-full" stage="p-0 sm:p-0">
              <Wall width={704}>
                <div className="flex flex-wrap gap-4">
                  <DoneWidget />
                  <CapacityWidget planned={495} />
                  <FreeWidget />
                  <FocusWidget state="idle" />
                  <FocusWidget state="paused" />
                  <StaleWidget />
                  <PlaceholderWidget />
                </div>
              </Wall>
            </Specimen>
          </Section>
        </div>
      </WorldProvider>
    </ThemeContext>
  );
};

const BackdropNight = () => (
  <img src="/art/blur/night.webp" alt="" width={1536} height={1024} loading="lazy" draggable={false} className="absolute inset-0 -z-10 size-full object-cover select-none" />
);

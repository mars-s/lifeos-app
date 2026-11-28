"use client";

import { Segmented } from "@/components/ui/segmented-control";
import { LifeosMark } from "@/components/lifeos/mark";
import { Section, Specimen } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { PlannerWindow } from "./desktop";
import { EnergyAnatomy, EnergyStates } from "./energy-specimens";
import { PhoneDay, PhoneWeek } from "./iphone";
import { CompactSwatches, DragDemo, NowDemo, StateSwatches } from "./motion";
import { TIMELINE_CSS, TimelineWorld } from "./parts";
import { TODAY_INDEX } from "./sample";

const SECTIONS = [
  { id: "states", label: "States" },
  { id: "iphone", label: "iPhone" },
  { id: "desktop", label: "Planner" },
  { id: "week", label: "Week" },
  { id: "energy", label: "Energy" },
  { id: "motion", label: "Motion" },
];

const PRINCIPLES = [
  { line: "Time is the page.", detail: "A day reads top to bottom along one ruled line. A block is as tall as it is long, and the gaps are named." },
  { line: "Three inks.", detail: "Hatched pencil for what LifeOS predicts, the Area colour for what you kept, graphite for what has passed." },
  { line: "Only now moves.", detail: "The line fills in as the day goes. Nothing glows, pulses or counts. A block changes ink once, when you keep it or when now passes it." },
];

const BLEND = [
  {
    from: "From Exoplan",
    items: ["A time rail down the left with a line that traces the day", "Blocks sized by their length, with the gaps labelled", "Travel folded into the block it belongs to", "A week strip with today marked and the day's ring", "An energy line that runs down the rail"],
  },
  {
    from: "From LifeOS",
    items: ["Warm paper and graphite. No glow, no gradient", "The rail is dots: one dot is 15 minutes, as in the Planner", "Area colours fill only what you have committed to", "The ring is Capacity, drawn in the same dots as the widgets", "The line on the rail is energy, estimated from Oura sleep"],
  },
];

const MOTION = [
  { name: "Keep", detail: "The hatch lines thicken until they meet, 360 ms ease-out, and the tick box fades in. One light haptic on iPhone." },
  { name: "Drag", detail: "The block lifts 1.5% with a shadow and a time readout, snaps to 15 minutes, and settles in 220 ms. Dropping a prediction keeps it." },
  { name: "Into the past", detail: "As now passes a block's end the colour drains to graphite over 360 ms. A prediction is never drawn in the past: it moves on." },
  { name: "Now", detail: "The bead and the line step once a minute and ease 360 ms. The rail behind the bead joins up into a solid line." },
  { name: "Reduced motion", detail: "Hatch and colour cross-fade in 160 ms. Nothing lifts, scales or slides." },
];

export const TimelineBoard = () => {
  const [theme, setTheme] = useTheme();
  return (
    <ThemeContext value={theme}>
      <TimelineWorld>
        <style href="lifeos-timeline" precedence="default">
          {TIMELINE_CSS}
        </style>
        <div className="mx-auto w-full max-w-[90rem] px-4 pb-32 [--tl-ground:var(--surface-inset)] sm:px-8 lg:px-12">
          <header className="sticky top-0 z-40 -mx-4 flex h-16 items-center gap-6 bg-background/85 px-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
            <a href="/design" className="flex items-center gap-2 rounded-md">
              <LifeosMark />
              <span className="text-heading font-semibold">LifeOS</span>
              <span className="text-small text-muted-foreground">Timeline</span>
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
                LifeOS timeline Planner design direction
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

          <Section id="states" title="States" lede="A block is drawn by two facts: has Avi kept it, and has now passed it. Each state reads without colour, by its fill, its box and its title.">
            <Specimen name="The inks" note="Predicted, kept, and the two ways a block ends. External Commitments and Trips sit beside them." className="md:col-span-6 xl:col-span-8" stage="items-stretch justify-start">
              <StateSwatches />
            </Specimen>
            <Specimen name="Short blocks" note="A 20 minute block keeps one line: the box, the title and the start time." className="md:col-span-6 xl:col-span-4">
              <CompactSwatches />
            </Specimen>
          </Section>

          <Section
            id="iphone"
            title="iPhone"
            lede="The timeline is the second face of the Today tab. The week strip moves between days, and each day shows its ink: yesterday in graphite, today in colour, tomorrow in pencil."
          >
            <Specimen name="Yesterday" note="Everything is graphite. Done is ticked and struck. Not done keeps an open box and offers to move." className="md:col-span-3 xl:col-span-3" stage="p-3 sm:p-4">
              <PhoneDay index={TODAY_INDEX - 1} />
            </Specimen>
            <Specimen name="Today" note="The rail is solid up to now. Kept blocks are filled, two predictions wait later, and the parcel run carries its drive." className="md:col-span-3 xl:col-span-3" stage="p-3 sm:p-4">
              <PhoneDay index={TODAY_INDEX} />
            </Specimen>
            <Specimen name="Tomorrow" note="Mostly pencil. Tap a hatched block to keep it, or Keep all. The one block Avi placed is already filled." className="md:col-span-3 xl:col-span-3" stage="p-3 sm:p-4">
              <PhoneDay index={TODAY_INDEX + 1} />
            </Specimen>
            <Specimen name="Week" note="Pull the strip down for the week: seven columns of shapes with no words, and each day's planned time. Tap a column to open the day." className="md:col-span-3 xl:col-span-3" stage="p-3 sm:p-4">
              <PhoneWeek />
            </Specimen>
          </Section>

          <Section
            id="desktop"
            title="Planner"
            lede="The Brain Dump and the day columns stay as they are. The Timebox pane becomes the timeline, and each Task card shows the ink of its block beside its time."
          >
            <Specimen name="Day" note="Today in the pane. The Day and Week switch works. Keep all takes every prediction for the day in one undoable change." className="col-span-full" stage="p-3 sm:p-5">
              <PlannerWindow start="day" />
            </Specimen>
          </Section>

          <Section id="week" title="Week" lede="Week takes the room of the day columns. The Brain Dump stays, so a thought can still be dragged onto any day. Each column keeps its Capacity dots.">
            <Specimen name="Week" note="Monday and Tuesday in graphite, today in colour with the now line, the rest in pencil where LifeOS predicts. Sunday is free." className="col-span-full" stage="p-3 sm:p-5">
              <PlannerWindow start="week" />
            </Specimen>
          </Section>

          <Section
            id="energy"
            title="Energy"
            lede="The rail carries an estimate of Avi's energy through the day, worked out from his Oura sleep. The further the line leans from the rail, the more he has. It is drawn in the same three inks as the blocks."
          >
            <Specimen name="The day's shape" note="A rise after waking, a peak late in the morning, a dip after lunch, a second wind, then a wind down towards Oura's bedtime. A tap on the rail opens the reading." className="col-span-full">
              <EnergyAnatomy />
            </Specimen>
            <Specimen name="Curve states" note="Solid when it comes from last night, hatched when it is only the usual pattern, graphite when the day is over, and absent when there is nothing honest to draw." className="col-span-full" stage="justify-start">
              <EnergyStates />
            </Specimen>
          </Section>

          <Section id="motion" title="Motion" lede="Four things move, and each moves once. Try them here.">
            <Specimen name="Keep and drag" note="Keeping fills the hatching in. Dragging a prediction keeps it at the new time." className="md:col-span-3 xl:col-span-6" stage="justify-start">
              <DragDemo />
            </Specimen>
            <Specimen name="Now" note="Slide now through the day. Blocks drain to graphite as it passes, and a prediction it reaches steps aside." className="md:col-span-3 xl:col-span-6" stage="justify-start">
              <NowDemo />
            </Specimen>
            <div className="col-span-full rounded-[1.375rem] bg-surface p-5">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
                {MOTION.map((item) => (
                  <div key={item.name}>
                    <dt className="text-small font-medium">{item.name}</dt>
                    <dd className="mt-1 text-small text-pretty text-muted-foreground">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Section>
        </div>
      </TimelineWorld>
    </ThemeContext>
  );
};

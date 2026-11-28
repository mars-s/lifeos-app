"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/toast-stack";
import { LifeosMark } from "@/components/lifeos/mark";
import { Section, Specimen } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { GenBlock } from "./block";
import { OUTPUTS } from "./outputs.gen";
import { ANSWER_ONE, BROKEN, COST, EMPTY, LOADING_FRAME, LOADING_GRAMMAR, MIXED } from "./specs";

const SECTIONS = [
  { id: "asks", label: "Eighteen asks" },
  { id: "mixed", label: "Both at once" },
  { id: "states", label: "States" },
  { id: "phone", label: "iPhone" },
  { id: "seam", label: "The seam" },
];

const PRINCIPLES = [
  { line: "One language.", detail: "The AI writes short tags. If every tag is one of ours, the block draws in the app. If it also needed HTML of its own, the same tags draw inside a sealed frame." },
  { line: "One renderer.", detail: "The same small script and the same stylesheet run in the app and inside the frame. A figure, a chart and a button are the same pixels either way." },
  { line: "Data in, tools out.", detail: "A block reads sockets and live queries by name and holds none of it. A button calls a tool, through the same approval as any agent." },
];

const LAYERS = [
  { name: "LifeOS parts", when: "Data we know", words: "A Task, a note, the day meter. Drawn by the app's own components, placed with one tag." },
  { name: "The grammar", when: "Everything else", words: "Twenty-two tags: layout, text, a figure, a meter, a chart, a table, controls, data." },
  { name: "A sealed frame", when: "The exception", words: "3D, a game, free drawing, logic of its own. No network, no reach into LifeOS." },
];

const SEAM = [
  { thing: "Colour and type", how: "The app reads its own tokens and Inter and hands them to the frame as CSS variables and font data. Nothing is copied by hand." },
  { thing: "The parts", how: "The frame carries the same renderer, so a Num or a Chart inside it is drawn by the same code." },
  { thing: "Plain HTML", how: "A bare button, input, table or heading is styled by the same stylesheet." },
  { thing: "Size", how: "The frame reports its height and the card follows. It never scrolls inside." },
  { thing: "Loading", how: "Each part draws its own ghost while its data is on the way. The frame stays hidden until it is ready." },
  { thing: "Light and dark", how: "Tokens are light-dark pairs. The app tells the frame which is on, and nothing reloads." },
  { thing: "Focus and keys", how: "Tab walks through the frame in order with the same ring. Escape hands focus back." },
  { thing: "Haptics", how: "A control taps through one function. In the frame it crosses the bridge to the same one." },
  { thing: "Motion", how: "Words and inline numbers morph with torph, dot figures flip their dots, and both stop under reduced motion." },
];

const SHOWN = [
  { value: "hidden", label: "Hidden" },
  { value: "shown", label: "Shown" },
] as const;

const FRAMES = ["frames"] as const;

export const GenuiBoard = () => {
  const [theme, setTheme] = useTheme();
  const [layers, setLayers] = useState<"hidden" | "shown">("hidden");
  const reveal = layers === "shown";
  return (
    <ThemeContext value={theme}>
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-32 sm:px-8 lg:px-12">
        <header className="sticky top-0 z-40 -mx-4 flex h-16 items-center gap-6 bg-background/85 px-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
          <a href="/design" className="flex items-center gap-2 rounded-md">
            <LifeosMark />
            <span className="text-heading font-semibold">LifeOS</span>
            <span className="text-small text-muted-foreground">GenUI</span>
          </a>
          <nav aria-label="Sections" className="ml-auto hidden items-center gap-1 lg:flex">
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="rounded-full px-2.5 py-1 text-small text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-foreground/[0.05] hover:text-foreground">
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
              GenUI design direction
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
          <div className="grid gap-3 xl:pt-3">
            <div className="rounded-[1.375rem] bg-surface p-5">
              <h2 className="text-heading font-medium">Three layers</h2>
              <ol data-layers className="mt-3 space-y-3">
                {LAYERS.map((layer, index) => (
                  <li key={layer.name} className="flex gap-3">
                    <span className="mt-0.5 font-mono text-micro text-faint-foreground tabular-nums">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="text-small font-medium">{layer.name}</span>
                        <span className="text-micro text-muted-foreground">{layer.when}</span>
                      </span>
                      <span className="block text-small text-pretty text-muted-foreground">{layer.words}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div data-cost>
              <GenBlock title="What a spec costs" source={COST} />
            </div>
          </div>
        </section>

        <Section
          id="asks"
          title="Eighteen asks, one small model"
          lede="Haiku was given the prompt and one request. These are its replies, untouched, drawn live. Five of them are sealed frames running their own HTML. The arrow on a card draws it again as it would stream in."
        >
          <div className="col-span-full flex items-center justify-between gap-4 rounded-[1.375rem] bg-surface px-5 py-3">
            <p className="text-small text-pretty text-muted-foreground">Which layer drew which card?</p>
            <Segmented label="Layer names" size="sm" value={layers} onValueChange={setLayers} options={[...SHOWN]} />
          </div>
          <div data-asks className="col-span-full gap-3 rounded-[1.375rem] bg-surface p-3 [column-fill:balance] sm:columns-2 sm:p-4 xl:columns-3">
            {OUTPUTS.map((output) => (
              <figure key={output.id} data-ask={output.id} className="mb-5 break-inside-avoid">
                <GenBlock title={output.title} source={output.source} sockets={output.sockets.length > 0 ? FRAMES : undefined} reveal={reveal} />
                <figcaption className="px-3.5 pt-2 text-micro text-pretty text-muted-foreground">{output.ask}</figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section id="mixed" title="Both layers in one card" lede="The figures and the controls are grammar. The drawing under them is a sealed frame with a canvas. One value crosses between them by name.">
          <Specimen className="md:col-span-6 xl:col-span-5" stage="items-stretch justify-start" name="A spiral" note="Move the slider. The figure above flips its dots in the app, and the canvas in the frame reads the same value. Hand-written, to show the crossing.">
            <GenBlock title="Spiral" source={MIXED} reveal={reveal} />
          </Specimen>
          <Specimen className="md:col-span-6 xl:col-span-7" stage="items-stretch justify-start" name="Live data" note="The render Step feeds this block through a socket. Figures flip, the bar fills and the words morph as frames land. Stop calls a tool.">
            <GenBlock title="Rendering the frames" source={OUTPUTS.find((output) => output.id === "render-progress")?.source ?? ""} sockets={FRAMES} reveal={reveal} />
          </Specimen>
        </Section>

        <Section id="states" title="States" lede="Loading, empty, stale and broken look the same in both layers, because the card and the parts are the same.">
          <Specimen className="md:col-span-3 xl:col-span-4" stage="items-stretch justify-start" name="Loading, grammar" note="Each part draws its own ghost in its own shape until the rows arrive.">
            <GenBlock title="Today" source={LOADING_GRAMMAR} state="loading" reveal={reveal} />
          </Specimen>
          <Specimen className="md:col-span-3 xl:col-span-4" stage="items-stretch justify-start" name="Loading, sealed frame" note="The same spec inside a frame. The ghosts are drawn by the same code.">
            <GenBlock title="Today" source={LOADING_FRAME} state="loading" reveal={reveal} />
          </Specimen>
          <Specimen className="md:col-span-2 xl:col-span-4" stage="items-stretch justify-start" name="Empty" note="No rows is a plain line, not a blank card.">
            <GenBlock title="Logbook" source={EMPTY} />
          </Specimen>
          <Specimen className="md:col-span-2 xl:col-span-6" stage="items-stretch justify-start" name="Stale" note="Offline, the last answer stays, dimmed, with its time.">
            <GenBlock title="Capacity" source={ANSWER_ONE} state="stale" />
          </Specimen>
          <Specimen className="md:col-span-2 xl:col-span-6" stage="items-stretch justify-start" name="Not valid" note="A spec that fails the schema is never drawn. The reason goes back to the model for one retry.">
            <GenBlock title="Sleep" source={BROKEN} />
          </Specimen>
        </Section>

        <Section id="phone" title="On iPhone" lede="The same renderer in the same web view the notes editor uses. A row of figures wraps, a table scrolls sideways, and controls are sized for a thumb.">
          <Specimen className="col-span-full" stage="items-center" name="A Cmd+J answer" note="Three blocks in one answer at 390 points: one from live data, one from pasted numbers, one sealed frame.">
            <div data-phone className="w-full max-w-[24.375rem] space-y-3 rounded-[2.75rem] bg-background p-4 pt-6 shadow-float">
              <p className="px-1.5 text-small text-pretty">You have room today. Here is the day, your sleep, and something to breathe with before the methods section.</p>
              <GenBlock title="Today" source={ANSWER_ONE} reveal={reveal} />
              <GenBlock title="Sleep this week" source={OUTPUTS.find((output) => output.id === "sleep-chart")?.source ?? ""} reveal={reveal} />
              <GenBlock title="Breathe" source={OUTPUTS.find((output) => output.id === "breathing")?.source ?? ""} reveal={reveal} />
            </div>
          </Specimen>
        </Section>

        <Section id="seam" title="The seam" lede="Why you cannot tell. Every row is one thing both layers get from the same place.">
          <div className="col-span-full rounded-[1.375rem] bg-surface p-5">
            <dl data-seam className="grid gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {SEAM.map((row) => (
                <div key={row.thing}>
                  <dt className="text-small font-medium">{row.thing}</dt>
                  <dd className="mt-0.5 text-small text-pretty text-muted-foreground">{row.how}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Section>
      </div>
      <Toaster />
    </ThemeContext>
  );
};

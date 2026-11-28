"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/toast-stack";
import { LifeosMark } from "@/components/lifeos/mark";
import { undoLast } from "@/components/lifeos/undo";
import { Section, Specimen } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { DailyNote, NotebookCapture } from "./daily";
import { ModeSpecimens } from "./modes";
import { PhoneSpecimens } from "./iphone";
import { Backlinks, GraphLegend, LocalGraph, OutgoingLinks, VaultGraph } from "./links";
import { ShellSpecimens } from "./shell";
import { NotesProvider, useNotesWorld } from "./state";
import { StateSpecimens } from "./states";
import { NotesWindow } from "./window";
import { WritingSpecimens } from "./writing";

const SECTIONS = [
  { id: "home", label: "Home and editor" },
  { id: "writing", label: "Writing" },
  { id: "links", label: "Links" },
  { id: "daily", label: "Daily note" },
  { id: "shell", label: "In the app" },
  { id: "modes", label: "Modes" },
  { id: "states", label: "States" },
  { id: "iphone", label: "iPhone" },
];

const PRINCIPLES = [
  { line: "Paper first.", detail: "The page is the brightest thing on screen. The chrome steps back until you reach for it." },
  { line: "Everything links.", detail: "Notes, Tasks, Projects and Areas point at each other, and every link is something you can press." },
  { line: "Always yours.", detail: "It works offline, saves as you type, and merges edits from your other devices without asking." },
];

const BLEND = [
  {
    from: "From LifeOS",
    items: ["Warm paper and graphite, layers of tone, no borders", "Inter for words, Geist Mono for figures", "Depth buttons, press feedback, undo on every change", "Dots for anything you can count, and Area colours as dots"],
  },
  {
    from: "From Cupertino",
    items: ["A 700 px reading column with a 26 px line", "Round to-do boxes and links with no underline", "A see-through sidebar and glass menus", "Marks in the margin and a bar on the line you are on"],
  },
];

const FONTS = {
  inter: undefined,
  system: '-apple-system, "SF Pro Text", system-ui, sans-serif',
} as const;

export const NotesBoard = () => {
  const [theme, setTheme] = useTheme();
  const [font, setFont] = useState<keyof typeof FONTS>("inter");
  const world = useNotesWorld();
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
          <a href="/design" className="flex items-center gap-2 rounded-md">
            <LifeosMark />
            <span className="text-heading font-semibold">LifeOS</span>
            <span className="text-small text-muted-foreground">Notes</span>
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
              LifeOS Notes design direction
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

        <Section
          id="home"
          title="Home and editor"
          lede="One window. The Area tree and recent notes on the left, the page in the middle, its links on the right. Click a line to edit it, tick a box, or search."
        >
          <div className="col-span-full">
            <NotesWindow world={world} fontFamily={FONTS[font]} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <p className="max-w-xl text-small text-pretty text-muted-foreground">
                The sidebar is see-through in the Mac app only. In a browser, and with reduced transparency on, it is the usual solid surface.
              </p>
              <Segmented
                label="Note typeface"
                size="sm"
                value={font}
                onValueChange={setFont}
                options={[
                  { value: "inter", label: "Inter" },
                  { value: "system", label: "System" },
                ]}
              />
            </div>
          </div>
        </Section>

        <NotesProvider world={world}>
          <Section
            id="writing"
            title="Writing"
            lede="Markdown that shows its result as you type, like Obsidian. The syntax appears only on the line you are on, and links to the Planner are real controls."
          >
            <WritingSpecimens />
          </Section>
          <Section
            id="links"
            title="Links"
            lede="Every note knows what points at it. Notes and Tasks sit in one list, and the graph is a handful of dots in Area colours, never a hairball."
          >
            <Specimen
              name="Links panel"
              note="A small graph of this note’s neighbours, the Tasks that mention it, what links here with the sentence around the link, and what it links to."
              className="md:col-span-3 xl:col-span-4"
              stage="items-stretch justify-start p-3 sm:p-3"
            >
              <div className="w-full">
                <LocalGraph id="retrieval" className="mx-auto max-w-[17rem]" />
                <Backlinks id="retrieval" />
                <div className="mt-2">
                  <OutgoingLinks id="retrieval" />
                </div>
              </div>
            </Specimen>
            <Specimen
              name="Graph"
              note="A dot is a note, larger when more links touch it, coloured by Area. The Journal is neutral ink. Point at a dot to trace its links, press it to open the note."
              className="md:col-span-3 xl:col-span-8"
            >
              <div className="w-full max-w-[52rem] space-y-4">
                <VaultGraph current="retrieval" />
                <GraphLegend />
              </div>
            </Specimen>
          </Section>
          <Section
            id="daily"
            title="Daily note"
            lede="One note a day, tied to the Planner’s day. The plan sits on top, the journal under it, and pages typed in from the Moleskine keep their page number."
          >
            <Specimen
              name="The day"
              note="Pick a day from the week. Today shows the Planner’s meter and Tasks, live. A dot under a date means something was written."
              className="md:col-span-6 xl:col-span-7"
              stage="justify-start"
            >
              <DailyNote />
            </Specimen>
            <Specimen
              name="From the notebook"
              note="Built for typing with the notebook open beside you. Enter starts the next line, a leading t makes a Task, and the page number counts up by itself."
              className="md:col-span-6 xl:col-span-5"
              stage="bg-surface"
            >
              <NotebookCapture />
            </Specimen>
          </Section>
          <Section
            id="shell"
            title="In the app"
            lede="Notes is a module beside the Planner, not a separate app. It shares the sidebar, the command bar, the Areas and the undo."
          >
            <ShellSpecimens />
          </Section>
          <Section
            id="modes"
            title="Modes"
            lede="A proposal, not built. Planner and Notes as two modes of one window, with a switch where the Notes row is now. Avi decides."
          >
            <ModeSpecimens />
          </Section>
          <Section id="states" title="States" lede="What the screens look like when they are empty, offline, or catching up with another device.">
            <StateSpecimens />
          </Section>
          <Section
            id="iphone"
            title="iPhone"
            lede="The same notes under Liquid Glass. Bars and sheets float over the page, and the depth buttons from the Planner do the one main thing on each screen."
          >
            <PhoneSpecimens />
          </Section>
        </NotesProvider>
      </div>
      <Toaster />
    </ThemeContext>
  );
};

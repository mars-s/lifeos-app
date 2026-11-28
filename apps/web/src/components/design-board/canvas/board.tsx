"use client";

import { Check } from "@phosphor-icons/react";
import { Segmented } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/toast-stack";
import { LifeosMark } from "@/components/lifeos/mark";
import { Section, Specimen } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { BlockCanvas, LINE } from "./block";
import { BuildCanvas } from "./build";
import { SocketMark } from "./cards";
import { SOCKET_WORD, type SocketType } from "./model";
import { NotesCanvas } from "./notes-canvas";
import { RunCanvas } from "./run";
import { PLACES } from "./sample";

const SECTIONS = [
  { id: "notes", label: "A canvas of notes" },
  { id: "build", label: "AI builds it" },
  { id: "run", label: "A run" },
  { id: "blocks", label: "Custom blocks" },
];

const PRINCIPLES = [
  { line: "A desk, not a diagram.", detail: "Notes, Tasks and loose lines sit on dot paper. You move them by hand and draw a line between any two." },
  { line: "A Step is one command.", detail: "It takes values in and gives values out. Wire Steps together and they run in order, on your Mac, and keep what has not changed." },
  { line: "Pencil until you say run.", detail: "The AI lays out Steps in pencil while you watch. No command runs before you have read it, and one undo clears the lot." },
];

const SOCKETS = [
  { type: "text", example: "a brief, a prompt" },
  { type: "number", example: "a time, a count" },
  { type: "file", example: "film.mp4" },
  { type: "folder", example: "frames" },
] as const satisfies readonly { type: SocketType; example: string }[];

const CANVAS = "block p-0 sm:p-0 bg-transparent min-h-0";

const Yes = ({ on, word }: { on: boolean; word: string }) => (
  <td className="py-1.5 text-center">
    {on ? <Check weight="bold" className="mx-auto size-3.5 text-foreground" aria-label={word} /> : <span role="img" aria-label={`Cannot ${word.toLowerCase()}`} className="mx-auto block h-px w-2.5 bg-foreground/25" />}
  </td>
);

export const CanvasBoard = () => {
  const [theme, setTheme] = useTheme();
  return (
    <ThemeContext value={theme}>
      <div className="mx-auto w-full max-w-[90rem] px-4 pb-32 sm:px-8 lg:px-12">
        <header className="sticky top-0 z-40 -mx-4 flex h-16 items-center gap-6 bg-background/85 px-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12">
          <a href="/design" className="flex items-center gap-2 rounded-md">
            <LifeosMark />
            <span className="text-heading font-semibold">LifeOS</span>
            <span className="text-small text-muted-foreground">Canvas</span>
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
              Canvas and Workflows design direction
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
              <h2 className="text-heading font-medium">Four kinds of value</h2>
              <p className="mt-1 text-small text-pretty text-muted-foreground">A socket is drawn by its shape, never by a colour. A wire joins two of the same shape.</p>
              <ul data-sockets className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {SOCKETS.map((socket) => (
                  <li key={socket.type} className="flex items-start gap-2.5">
                    <span className="grid h-5 place-items-center">
                      <SocketMark type={socket.type} className="size-2.5 text-foreground/70 [--popover:var(--surface)]" />
                    </span>
                    <span className="min-w-0 text-small">
                      <span className="block font-medium">{SOCKET_WORD[socket.type]}</span>
                      <span className="block text-micro text-muted-foreground">{socket.example}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[1.375rem] bg-surface p-5">
              <h2 className="text-heading font-medium">Where it runs</h2>
              <table data-places className="mt-3 w-full text-small">
                <thead>
                  <tr className="text-micro text-muted-foreground">
                    <th scope="col" className="pb-1 text-left font-normal">
                      <span className="sr-only">Device</span>
                    </th>
                    {["See", "Edit", "Start", "Run"].map((head) => (
                      <th key={head} scope="col" className="w-12 pb-1 font-normal">
                        {head}
                      </th>
                    ))}
                    <th scope="col" className="hidden pb-1 pl-4 text-left font-normal sm:table-cell">
                      <span className="sr-only">What it does</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PLACES.map((row) => (
                    <tr key={row.place}>
                      <th scope="row" className="py-1.5 text-left font-medium">
                        {row.place}
                      </th>
                      <Yes on={row.see} word="See" />
                      <Yes on={row.edit} word="Edit" />
                      <Yes on={row.start} word="Start" />
                      <Yes on={row.run} word="Run" />
                      <td className="hidden py-1.5 pl-4 text-muted-foreground sm:table-cell">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-micro text-pretty text-muted-foreground">While the Mac sleeps, a run you start waits in the queue and begins when it wakes.</p>
            </div>
          </div>
        </section>

        <Section id="notes" title="A canvas of notes" lede="A canvas is a kind of note. It lives in the Area tree beside the others, syncs the same way and opens offline. Useful by itself, before anything runs.">
          <Specimen className="col-span-full" stage={CANVAS} name="Thesis map" note="Drag a card and its links follow. Drag the paper to pan, pinch or hold Cmd and scroll to zoom. A selected card shows the four dots a link starts from. The Task chip holds the real checkbox.">
            <NotesCanvas />
          </Specimen>
        </Section>

        <Section id="build" title="AI builds it while you watch" lede="Ask in Cmd+J. The Steps and wires arrive one at a time, in pencil, each one a tool call. Nothing is fixed in advance: the same tools would make one Step for a random number.">
          <Specimen className="col-span-full" stage={CANVAS} name="The launch film, as Steps" note="Press Build it. Seven Steps arrive in pencil. Before any command runs it asks, with every command in view and a row you can untick. Run, keep without running, or undo the lot.">
            <BuildCanvas />
          </Specimen>
        </Section>

        <Section id="run" title="A run" lede="Steps run in the order their wires need. A Step whose inputs have not changed is kept, not run again. The strip says what is running and always has Stop.">
          <Specimen className="col-span-full" stage={CANVAS} name="Rendering the frames" note="The ruler fills as frames land. The Frames card shows the last one. Stop ends every command at once and keeps the frames already made.">
            <RunCanvas />
          </Specimen>
        </Section>

        <Section id="blocks" title="Custom blocks" lede="When no LifeOS part fits, the AI writes a small page of its own. It sits in a sealed frame and reaches the canvas only through its sockets.">
          <Specimen className="md:col-span-6 xl:col-span-8" stage={CANVAS} name="Pick the poster" note="This block is real: a sealed frame running its own page. Pick a still and its time leaves by the socket, into the next command.">
            <BlockCanvas />
          </Specimen>
          <Specimen className="md:col-span-6 xl:col-span-4" stage="items-stretch justify-start" name="Where the line is" note="A part is the default. A custom block is the exception, and it never gets more than its sockets.">
            <ul className="w-full space-y-5">
              {LINE.map((side) => (
                <li key={side.name}>
                  <p className="flex items-baseline gap-2">
                    <span className="text-heading font-medium">{side.name}</span>
                    <span className="text-micro text-muted-foreground">{side.when}</span>
                  </p>
                  <ul className="mt-2 space-y-2 text-small text-muted-foreground">
                    {side.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-pretty">
                        <span aria-hidden="true" className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-foreground/25" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Specimen>
        </Section>
      </div>
      <Toaster />
    </ThemeContext>
  );
};

"use client";

import { useEffect } from "react";
import { Segmented } from "@/components/ui/segmented-control";
import { Toaster } from "@/components/ui/toast-stack";
import { LifeosMark } from "@/components/lifeos/mark";
import { undoLast } from "@/components/lifeos/undo";
import { Section } from "../specimen";
import { ThemeContext, useTheme } from "../theme";
import { AgentSpecimens } from "./agent-specimens";
import { useCmdJ } from "./ask";
import { MemorySpecimens } from "./memory";
import { NoteSpecimens } from "./notes";
import { PhoneSpecimens } from "./phone";
import { RunSpecimens } from "./run";
import { TaskSpecimens } from "./tasks";

const SECTIONS = [
  { id: "notes", label: "In Notes" },
  { id: "tasks", label: "In Tasks" },
  { id: "agent", label: "The agent" },
  { id: "run", label: "A longer run" },
  { id: "memory", label: "Memory" },
  { id: "iphone", label: "iPhone" },
];

const PRINCIPLES = [
  { line: "Where you are.", detail: "It comes to the line or the Task you are on. There is no chat window, no assistant page and no history to scroll." },
  { line: "Pencil, then ink.", detail: "What it suggests under your line is pencil. Nothing is saved until you keep it, and keeping it is one undo." },
  { line: "It shows its work.", detail: "A run you start acts by itself, where one undo takes it back. It says what it read, hands you a receipt, and asks first when a change is risky." },
];

const BLEND = [
  {
    from: "From Notion AI, 2023",
    items: ["Cmd+J on the line you are on", "A box under the text, never over it", "Quick actions first, typing second", "Keep, try again or discard, then ask for a change"],
  },
  {
    from: "From what came after",
    items: ["Cursor: the change is drawn where it will land", "Granola: your words and its words are two inks", "Linear: guesses wait on the field, unasked", "Agents: typed parts the app draws, and a receipt with undo"],
  },
];

export const AiBoard = () => {
  const [theme, setTheme] = useTheme();
  useCmdJ();
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
            <span className="text-small text-muted-foreground">AI</span>
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
              LifeOS AI design direction
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

        <Section id="notes" title="In Notes" lede="Cmd+J on the line you are on, or on a selection. The line stays lit, the page steps back, and the answer is written into the note in pencil.">
          <NoteSpecimens />
        </Section>
        <Section id="tasks" title="In Tasks" lede="The same key and the same box, on a Task. The answers are Planner things: steps, a time, an Estimate, linked notes, a draft.">
          <TaskSpecimens />
        </Section>
        <Section id="agent" title="The agent at work" lede="For work with more than one step, the agent sends back parts, not paragraphs. LifeOS draws each part with its own components.">
          <AgentSpecimens />
        </Section>
        <Section id="run" title="A longer run" lede="Say Do it and the work becomes a run. A run does not open a chat. It sits in one strip at the foot of the window. Open it, hide it, come back to it.">
          <RunSpecimens />
        </Section>
        <Section id="memory" title="Memory" lede="It remembers how you work so you do not have to say it twice. Every memory is a sentence you can read, rewrite, pin or forget.">
          <MemorySpecimens />
        </Section>
        <Section id="iphone" title="iPhone" lede="The same parts under Liquid Glass. Sheets rise from the bottom, and one depth button does the main thing on each screen.">
          <PhoneSpecimens />
        </Section>
      </div>
      <Toaster />
    </ThemeContext>
  );
};

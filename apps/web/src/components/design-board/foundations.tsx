"use client";

import { Flag } from "@phosphor-icons/react";
import { useContext, useEffect, useRef, useState } from "react";
import { AREA_COLOURS, areaVar } from "@/components/lifeos/area";
import { EstimateChip } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { AREAS } from "./sample-data";
import { Specimen } from "./specimen";
import { ThemeContext } from "./theme";

const SURFACES = [
  { token: "background", role: "The page" },
  { token: "surface", role: "Shells and sidebars" },
  { token: "surface-inset", role: "Panels, where content sits" },
  { token: "surface-raised", role: "Selected and pressed steps" },
  { token: "popover", role: "Open cards, menus and toasts" },
];

const INK = [
  { token: "foreground", role: "Titles and body" },
  { token: "muted-foreground", role: "Notes and Area names" },
  { token: "faint-foreground", role: "Counts and axis labels" },
];

const SIGNALS = [
  { token: "brand", role: "The one accent: selection and focus" },
  { token: "deadline", role: "The Deadline, and nothing else" },
  { token: "positive", role: "Confirmed, under Estimate" },
  { token: "negative", role: "Overdue, over Capacity" },
];

const Swatch = ({ token, role }: { token: string; role: string }) => {
  const theme = useContext(ThemeContext);
  const chip = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState({ theme, colour: "" });
  useEffect(() => {
    if (chip.current) setValue({ theme, colour: getComputedStyle(chip.current).backgroundColor });
  }, [theme]);
  return (
    <li className="flex items-start gap-3 py-2">
      <span
        ref={chip}
        className="mt-0.5 size-9 shrink-0 rounded-[10px] shadow-[inset_0_0_0_1px_var(--border)]"
        style={{ backgroundColor: `var(--${token})` }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-small">{token}</span>
          <span className="font-mono text-micro text-faint-foreground">{value.colour}</span>
        </span>
        <span className="block text-small text-pretty text-muted-foreground">{role}</span>
      </span>
    </li>
  );
};

const SwatchList = ({ swatches }: { swatches: { token: string; role: string }[] }) => (
  <ul className="w-full self-stretch">
    {swatches.map((swatch) => (
      <Swatch key={swatch.token} {...swatch} />
    ))}
  </ul>
);

export const ColourSpecimens = () => (
  <>
    <Specimen
      name="Surfaces"
      note="Depth comes from tone. Each layer is one step lighter or darker than the one it sits on, so nothing needs a border."
      className="md:col-span-6 xl:col-span-5"
      stage="items-stretch justify-start"
    >
      <SwatchList swatches={SURFACES} />
    </Specimen>
    <Specimen
      name="Ink and signals"
      note="Three text roles and one cool accent. Amber belongs to the Deadline alone."
      className="md:col-span-6 xl:col-span-7"
      stage="items-stretch justify-start"
    >
      <div className="grid w-full gap-x-8 @2xl:grid-cols-2">
        <SwatchList swatches={INK} />
        <SwatchList swatches={SIGNALS} />
      </div>
    </Specimen>
    <Specimen
      name="Area palette"
      note="Eight hues at one lightness and chroma, so no Area shouts over another. An Area shows up as a dot, a tinted Work Block or a bar segment."
      className="md:col-span-6 xl:col-span-12"
    >
      <ul className="grid w-full grid-cols-4 gap-x-2 gap-y-6 @2xl:grid-cols-8">
        {AREA_COLOURS.map((colour) => {
          const area = AREAS.find((entry) => entry.colour === colour);
          return (
            <li key={colour} className="flex flex-col items-center gap-2.5 text-center">
              <span className="flex h-14 w-full max-w-24 items-end gap-1 rounded-xl p-1.5" style={{ backgroundColor: `color-mix(in oklab, ${areaVar(colour)} 20%, var(--surface-inset))` }}>
                <span className="size-3 rounded-full" style={{ backgroundColor: areaVar(colour) }} />
                <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: areaVar(colour) }} />
              </span>
              <span>
                <span className="block font-mono text-small">{colour}</span>
                <span className="block text-small text-muted-foreground">{area?.name ?? "Spare"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Specimen>
  </>
);

const SCALE = [
  { token: "display", sample: "Tuesday 18 November", style: "text-display font-semibold", spec: "44 / 46  −3.5%  600" },
  { token: "title", sample: "Honours thesis", style: "text-title font-semibold", spec: "24 / 28  −2%  600" },
  { token: "heading", sample: "Draft the thesis outline", style: "text-heading font-medium", spec: "17 / 24  −1%  500" },
  {
    token: "body",
    sample: "Three chapters at most. Start from the reading notes, not a blank page.",
    style: "text-body",
    spec: "15 / 24  0  400",
  },
  { token: "small", sample: "University, Honours thesis", style: "text-small text-muted-foreground", spec: "13 / 20  0  400" },
  { token: "micro", sample: "Synced with Things a few seconds ago", style: "text-micro text-faint-foreground", spec: "11 / 16  0  400" },
];

export const TypeSpecimens = () => (
  <>
    <Specimen
      name="Inter, six sizes"
      note="Optical sizing is on, tracking tightens as the size grows, and weight stops at 600. Hierarchy comes from size and tone."
      className="md:col-span-6 xl:col-span-7"
      stage="items-stretch justify-start"
    >
      <ul className="w-full space-y-5">
        {SCALE.map((step) => (
          <li key={step.token} className="grid gap-x-6 gap-y-1 @xl:grid-cols-[7.5rem_1fr]">
            <span className="pt-1 font-mono text-micro whitespace-pre text-faint-foreground">
              <span className="block text-small text-muted-foreground">{step.token}</span>
              {step.spec}
            </span>
            <span className={cn("min-w-0 text-balance", step.style)}>{step.sample}</span>
          </li>
        ))}
      </ul>
    </Specimen>
    <Specimen
      name="Geist Mono for figures"
      note="Every time, Estimate and count is set in tabular mono, so digits hold their column while they roll. Dates stay in Inter."
      className="md:col-span-6 xl:col-span-5"
      stage="items-stretch justify-between gap-8"
    >
      <p className="font-mono text-[2.5rem] leading-none font-medium tracking-[-0.03em] @md:text-[3.25rem]">10:00 – 11:30</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        {[
          ["Estimate", "1:30"],
          ["Focus Session", "24:58"],
          ["Checklist", "1/3"],
          ["Capacity", "4:15 of 6:00"],
        ].map(([term, figure]) => (
          <div key={term}>
            <dt className="text-small text-muted-foreground">{term}</dt>
            <dd className="font-mono text-heading">{figure}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-3 rounded-xl bg-foreground/[0.04] p-3 text-small @md:grid-cols-2">
        <p className="space-y-1.5">
          <span className="flex items-center gap-1 font-medium text-deadline">
            <Flag weight="fill" className="size-3.5" aria-hidden="true" />
            Fri 21 Nov
          </span>
          <span className="block text-muted-foreground">A Deadline is a date. Amber flag, Inter.</span>
        </p>
        <p className="space-y-1.5">
          <span className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground">10:00</span>
            <EstimateChip minutes={90} />
          </span>
          <span className="block text-muted-foreground">Allocated time is a figure. Neutral chip, mono.</span>
        </p>
      </div>
    </Specimen>
  </>
);

const RADII = [
  { name: "sm", px: 6, use: "Chips, keys" },
  { name: "md", px: 8, use: "Menu rows" },
  { name: "lg", px: 12, use: "Task rows, Work Blocks" },
  { name: "xl", px: 16, use: "Panels, open cards" },
  { name: "2xl", px: 22, use: "Shells" },
];

const SPACES = [4, 8, 12, 16, 24, 32, 48];

export const SurfaceSpecimens = () => (
  <>
    <Specimen
      name="Layers"
      note="A shell frames a panel, a panel holds wells. Only things that float above the page (an open card, a menu, a toast) earn a shadow."
      className="md:col-span-6"
      stage="p-0 sm:p-0 overflow-hidden"
    >
      <div className="w-full flex-1 bg-background p-4 sm:p-6">
        <p className="mb-2 font-mono text-micro text-faint-foreground">background</p>
        <div className="rounded-[1.375rem] bg-surface p-1.5">
          <p className="px-2.5 pt-1.5 pb-2 font-mono text-micro text-faint-foreground">surface</p>
          <div className="relative rounded-2xl bg-surface-inset p-3 pb-12">
            <p className="mb-2 font-mono text-micro text-faint-foreground">surface-inset</p>
            <div className="rounded-xl bg-foreground/[0.04] p-3">
              <p className="font-mono text-micro text-faint-foreground">well, 4% ink</p>
            </div>
            <div className="absolute right-4 -bottom-5 rounded-2xl bg-popover px-4 py-3 shadow-float">
              <p className="font-mono text-micro text-faint-foreground">popover, shadow-float</p>
              <p className="text-small">Draft the thesis outline</p>
            </div>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </Specimen>
    <Specimen
      name="Elevation"
      note="Rest has none. Lift is for the thing in your hand. Float is for what sits above."
      className="md:col-span-3"
      stage="gap-4 items-stretch"
    >
      {[
        { name: "rest", shadow: "", tone: "bg-foreground/[0.05]" },
        { name: "shadow-lift", shadow: "shadow-lift", tone: "bg-popover" },
        { name: "shadow-float", shadow: "shadow-float", tone: "bg-popover" },
      ].map((level) => (
        <div key={level.name} className={cn("flex h-12 items-center rounded-xl px-3.5", level.tone, level.shadow)}>
          <span className="font-mono text-small text-muted-foreground">{level.name}</span>
        </div>
      ))}
    </Specimen>
    <Specimen
      name="Radius and spacing"
      note="Radii nest: an inner corner is the outer one minus the gap. Spacing sits on a 4 px grid."
      className="md:col-span-3"
      stage="items-stretch gap-6"
    >
      <ul className="flex items-end justify-between gap-1">
        {RADII.map((radius) => (
          <li key={radius.name} className="flex flex-col items-center gap-1.5" title={radius.use}>
            <span
              className="size-9 border-t-2 border-l-2 border-foreground/45 bg-foreground/[0.05]"
              style={{ borderTopLeftRadius: radius.px }}
            />
            <span className="font-mono text-micro text-faint-foreground">{radius.px}</span>
          </li>
        ))}
      </ul>
      <ul className="flex items-end justify-between gap-1">
        {SPACES.map((space) => (
          <li key={space} className="flex flex-col items-center gap-1.5">
            <span className="w-1.5 rounded-full bg-brand" style={{ height: space }} />
            <span className="font-mono text-micro text-faint-foreground">{space}</span>
          </li>
        ))}
      </ul>
    </Specimen>
  </>
);

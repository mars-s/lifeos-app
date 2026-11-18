"use client";

import { useState } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { Segmented } from "@/components/ui/segmented-control";
import {
  AreaCover,
  BACKDROP_SETS,
  BACKDROPS,
  backdropIsDark,
  BackdropScene,
  RITUALS,
  RitualArt,
  SPOTS,
  SpotArt,
  type Backdrop,
  type BackdropSet,
  type Ritual,
  type Spot,
} from "@/components/lifeos/art";
import { AREA_COLOURS } from "@/components/lifeos/area";
import { ProgressRing } from "@/components/lifeos/progress-ring";
import { DotMatrix } from "@/components/lifeos/dot-matrix";
import { DotRing, useFocusSession } from "@/components/lifeos/focus-timer";
import { formatCountdown } from "@/components/lifeos/format";
import { LifeosMark } from "@/components/lifeos/mark";
import { cn } from "@/lib/utils";
import { AREAS } from "./sample-data";
import { Specimen } from "./specimen";

const SPOT_USE: Record<Spot, string> = {
  "today-clear": "Today, cleared",
  "inbox-empty": "Inbox, empty",
  upcoming: "Upcoming",
  anytime: "Anytime",
  someday: "Someday",
  logbook: "Logbook",
  planning: "Daily planning",
  focus: "Focus Session",
  shutdown: "Shutdown",
  done: "Day closed",
};

const RITUAL_USE: Record<Ritual, string> = {
  planning: "Daily planning",
  focus: "Focus Session",
  shutdown: "Shutdown",
  inbox: "Inbox",
  someday: "Someday",
  done: "Day closed",
};

const title = (name: string) => `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;

const MATERIALS = ["dots", "arc", "plain", "sea"] as const;
type Material = (typeof MATERIALS)[number];

const IconTile = ({ finish, size }: { finish: "paper" | "graphite"; size: number }) => (
  <img
    src={`/art/icon/${finish}.webp`}
    alt={`LifeOS app icon, ${finish}`}
    width={size}
    height={size}
    draggable={false}
    className="shrink-0 rounded-[22.5%] shadow-lift select-none"
    style={{ width: size, height: size }}
  />
);

const FocusBackdropDemo = () => {
  const [backdrop, setBackdrop] = useState<Backdrop>("morning");
  const [set, setSet] = useState<BackdropSet>("blur");
  const session = useFocusSession(25 * 60, 18 * 60 + 12);
  const dark = backdropIsDark(backdrop, set);
  return (
    <BackdropScene backdrop={backdrop} set={set} className="flex min-h-[30rem] w-full flex-1 flex-col rounded-2xl sm:min-h-[38rem]">
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center px-6 pt-10 pb-24 transition-colors duration-700",
          dark ? "text-white" : "text-[#282521]",
        )}
      >
        <p className="text-small opacity-70">Focus Session</p>
        <p className="mt-1 text-heading font-medium">Draft the thesis outline</p>
        <RollingNumber
          value={formatCountdown(session.remainingSeconds)}
          stagger={0}
          className="font-mono text-[4.5rem] leading-[1.3] font-medium tracking-[-0.04em] sm:text-[6rem]"
        />
        <DotRing remaining={session.remainingSeconds / session.totalSeconds} size={44} dot={2.2} litClassName="fill-current" />
      </div>
      <div className="flex flex-wrap justify-center gap-2 p-4">
        <Segmented
          label="Backdrop set"
          size="sm"
          value={set}
          onValueChange={setSet}
          className="bg-surface/80 backdrop-blur-md"
          options={BACKDROP_SETS.map((name) => ({ value: name, label: title(name) }))}
        />
        <Segmented
          label="Time of day"
          size="sm"
          value={backdrop}
          onValueChange={setBackdrop}
          className="bg-surface/80 backdrop-blur-md"
          options={BACKDROPS.map((name) => ({ value: name, label: title(name) }))}
        />
      </div>
    </BackdropScene>
  );
};

const MaterialDemo = () => {
  const [material, setMaterial] = useState<Material>("arc");
  return (
    <div className="relative isolate flex min-h-72 w-full flex-1 flex-col justify-between overflow-hidden rounded-2xl">
      {MATERIALS.map((name) => (
        <span key={name} className={cn("absolute inset-0 -z-10 transition-opacity duration-500", name === material ? "opacity-100" : "opacity-0")}>
          {name === "sea" ? (
            <>
              <img src="/art/blur/sea.webp" alt="" loading="lazy" className="size-full object-cover" />
              <DotMatrix src="/art/blur/sea.webp" />
            </>
          ) : (
            <>
              <img src={`/art/backdrops/material-paper-${name}.webp`} alt="" loading="lazy" className="size-full object-cover dark:hidden" />
              <img
                src={`/art/backdrops/material-graphite-${name}.webp`}
                alt=""
                loading="lazy"
                className="hidden size-full object-cover dark:block"
              />
            </>
          )}
        </span>
      ))}
      <div className={cn("p-6 transition-colors duration-500 sm:p-8", material === "sea" && "text-white [&_p]:text-white/85")}>
        <p className="text-small text-muted-foreground">Tuesday 18 November</p>
        <p className="mt-1 text-title font-semibold sm:text-[2rem] sm:leading-9 sm:tracking-[-0.025em]">Good morning, Avi</p>
        <p className="mt-2 max-w-xs text-pretty text-muted-foreground">Four Tasks today, and 3:15 still free.</p>
      </div>
      <div className="p-4">
        <Segmented
          label="Material"
          size="sm"
          className="bg-surface/80 backdrop-blur-md"
          value={material}
          onValueChange={setMaterial}
          options={MATERIALS.map((name) => ({ value: name, label: title(name) }))}
        />
      </div>
    </div>
  );
};

export const ArtSpecimens = () => (
  <>
    <Specimen
      name="App icon and mark"
      note="Nine dots, four filled: the day filling up. The icon is pressed into paper or graphite. The flat mark is drawn from the same numbers and is the favicon."
      className="md:col-span-6 xl:col-span-5"
      stage="gap-7"
    >
      <div className="flex items-end gap-4">
        <IconTile finish="paper" size={120} />
        <IconTile finish="graphite" size={120} />
      </div>
      <div className="flex items-center gap-4">
        <IconTile finish="paper" size={48} />
        <IconTile finish="graphite" size={48} />
        <IconTile finish="paper" size={28} />
        <IconTile finish="graphite" size={28} />
        <LifeosMark className="size-10" />
        <LifeosMark className="size-5" />
      </div>
    </Specimen>
    <Specimen
      name="Welcome backdrops"
      note="Paper by day and graphite at night, with dots pressed into one corner, or a blurred sea read back as dots. For the welcome screen and the top of a ritual. The calm side is where the words go."
      className="md:col-span-6 xl:col-span-7"
      stage="p-0 sm:p-0 items-stretch"
    >
      <MaterialDemo />
    </Specimen>
    <Specimen
      name="Spot illustrations"
      note="One quiet desk object per list and ritual, each with a single blue dot. They sit on empty screens, and swap to a night version in the dark theme."
      className="md:col-span-6 xl:col-span-12"
    >
      <ul className="grid w-full grid-cols-2 gap-x-2 gap-y-4 @xl:grid-cols-3 @4xl:grid-cols-5">
        {SPOTS.map((spot) => (
          <li key={spot} className="flex flex-col items-center">
            <SpotArt spot={spot} className="w-full max-w-56" />
            <span className="-mt-2 text-small text-muted-foreground">{SPOT_USE[spot]}</span>
          </li>
        ))}
      </ul>
    </Specimen>
    <Specimen
      name="Area covers"
      note="Every Area gets a cover in its own colour, each one built from thousands of painted dots. It heads the Area page and sits beside its Projects."
      className="md:col-span-6 xl:col-span-7"
    >
      <ul className="grid w-full grid-cols-4 gap-3 @2xl:gap-4">
        {AREA_COLOURS.map((colour) => (
          <li key={colour} className="flex flex-col items-center gap-2">
            <AreaCover colour={colour} className="h-auto w-full" />
            <span className="text-small text-muted-foreground">
              {AREAS.find((area) => area.colour === colour)?.name ?? title(colour)}
            </span>
          </li>
        ))}
      </ul>
    </Specimen>
    <Specimen
      name="Area page header"
      note="The cover is the one bright thing on the page. Everything around it stays quiet."
      className="md:col-span-6 xl:col-span-5"
      stage="items-stretch justify-center gap-6"
    >
      <div className="flex items-center gap-5">
        <AreaCover colour="violet" className="size-28 shadow-lift" />
        <div className="min-w-0">
          <p className="text-title font-semibold">University</p>
          <p className="text-small text-muted-foreground">2 Projects, 14 Tasks</p>
        </div>
      </div>
      <ul className="space-y-1">
        {[
          { name: "Honours thesis", done: 7, total: 12 },
          { name: "COMP3900 group project", done: 3, total: 9 },
        ].map((project) => (
          <li key={project.name} className="flex h-11 items-center gap-3 rounded-xl bg-foreground/[0.04] px-3 text-small">
            <ProgressRing value={project.done / project.total} size={20} stroke={3} colour="var(--area-violet)" label={`${project.name} progress`} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="font-mono text-faint-foreground">
              {project.done}/{project.total}
            </span>
          </li>
        ))}
      </ul>
    </Specimen>
    <Specimen
      name="Ritual scenes"
      note="Hand-painted, a little funny, and only on the rituals: planning, focus, Shutdown. A small reward for showing up."
      className="md:col-span-6 xl:col-span-12"
    >
      <ul className="grid w-full grid-cols-2 gap-4 @xl:grid-cols-3 @4xl:grid-cols-6">
        {RITUALS.map((ritual) => (
          <li key={ritual} className="flex flex-col items-center gap-2">
            <RitualArt ritual={ritual} className="h-auto w-full" />
            <span className="text-small text-muted-foreground">{RITUAL_USE[ritual]}</span>
          </li>
        ))}
      </ul>
    </Specimen>
    <Specimen
      name="Focus backdrop"
      note="Three sets, each at five times of day: a blurred photograph read back as a field of dots, a painted landscape of dots, and a quiet room. A Focus Session, daily planning and Shutdown sit on the one that matches the clock."
      className="md:col-span-6 xl:col-span-12"
      stage="p-0 sm:p-0 items-stretch"
    >
      <FocusBackdropDemo />
    </Specimen>
  </>
);

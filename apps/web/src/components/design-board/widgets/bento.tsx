"use client";

import type { ReactNode } from "react";
import { LifeosMark } from "@/components/lifeos/mark";
import { cn } from "@/lib/utils";
import { BrainDumpButton, BrainDumpCircle, BrainDumpControl, CapacityCircle, InlineAccessory, IslandCompact, IslandExpanded, IslandMinimal, LiveActivity, NextUpRectangle, TodayCircle } from "./iphone";
import { Fit, WallpaperImage } from "./parts";
import { CapacityWidget, FocusWidget, NextUpWidget, TodayWidget, UpcomingWidget, WeekWidget } from "./tiles";

export type BentoShape = "wide" | "square";

export const BENTO = {
  wide: { width: 1920, height: 1080 },
  square: { width: 1440, height: 1440 },
} as const satisfies Record<BentoShape, { width: number; height: number }>;

const GAP = 16;
const PLAIN = "bg-[light-dark(oklch(0.94_0.008_85),oklch(0.155_0.004_264))]";

const Cell = ({ name, night = false, className, children }: { name?: string; night?: boolean; className?: string; children: ReactNode }) => (
  <div className={cn("relative isolate grid min-h-0 min-w-0 place-items-center overflow-hidden rounded-[2.25rem]", night ? "dark" : PLAIN, className)}>
    {night && <WallpaperImage wallpaper="night" dim={0.12} />}
    {children}
    {name && <p className={cn("absolute bottom-5 left-7 text-small font-medium", night ? "text-white/70" : "text-muted-foreground")}>{name}</p>}
  </div>
);

const Stack = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("grid min-h-0 grid-rows-2", className)} style={{ gap: GAP }}>
    {children}
  </div>
);

const Pair = ({ children }: { children: ReactNode }) => (
  <div className="grid min-h-0 grid-cols-2" style={{ gap: GAP }}>
    {children}
  </div>
);

const Week = () => (
  <Cell>
    <WeekWidget />
  </Cell>
);

const TodayLarge = () => (
  <Cell>
    <TodayWidget size="large" />
  </Cell>
);

const TodayPlan = () => (
  <Stack>
    <Cell>
      <TodayWidget />
    </Cell>
    <Pair>
      <Cell>
        <NextUpWidget />
      </Cell>
      <Cell>
        <CapacityWidget />
      </Cell>
    </Pair>
  </Stack>
);

const Control = () => (
  <Cell night name="Control Centre">
    <div className="mb-6 flex items-center gap-3">
      <BrainDumpButton />
      <BrainDumpControl className="w-[9.5rem]" />
    </div>
  </Cell>
);

const Focus = () => (
  <Cell>
    <FocusWidget />
  </Cell>
);

const Upcoming = () => (
  <Cell>
    <UpcomingWidget />
  </Cell>
);

const Lock = ({ zoom }: { zoom: number }) => (
  <Cell night name="Lock Screen">
    <div className="mb-5 flex flex-col items-center gap-6" style={{ zoom }}>
      <InlineAccessory />
      <div className="flex items-center gap-5">
        <NextUpRectangle />
        <CapacityCircle />
        <BrainDumpCircle />
        <TodayCircle />
      </div>
      <LiveActivity className="w-[22.875rem]" />
    </div>
  </Cell>
);

const Island = ({ row = false }: { row?: boolean }) => (
  <Cell name="Dynamic Island" className="bg-[light-dark(oklch(0.905_0.009_85),oklch(0.27_0.006_264))]">
    <div className={cn("flex items-center", row ? "gap-12" : "mb-5 flex-col gap-6")} style={{ zoom: 1.2 }}>
      <div className="flex items-center gap-4">
        <IslandMinimal />
        <IslandCompact />
      </div>
      <IslandExpanded />
    </div>
  </Cell>
);

const Masthead = ({ stacked }: { stacked: boolean }) => (
  <div className={cn("flex flex-1", stacked ? "flex-col justify-center gap-2" : "items-center justify-between")}>
    <p className="flex items-center gap-3">
      <LifeosMark className="size-8" />
      <span className="text-[1.75rem] leading-8 font-semibold tracking-[-0.025em]">LifeOS</span>
    </p>
    <p className="text-[1.25rem] leading-7 text-muted-foreground">Widgets for iPhone and Mac</p>
  </div>
);

const rows = (...heights: number[]) => ({ gap: GAP, gridTemplateRows: heights.map((height) => `${height}px`).join(" ") });
const columns = (...widths: number[]) => ({ gap: GAP, gridTemplateColumns: widths.map((width) => `${width}px`).join(" ") });

const Wide = () => (
  <div className="grid" style={rows(428, 428)}>
    <div className="grid min-h-0" style={columns(768, 408, 584)}>
      <Week />
      <TodayLarge />
      <TodayPlan />
    </div>
    <div className="grid min-h-0" style={columns(584, 640, 536)}>
      <Stack>
        <Upcoming />
        <Pair>
          <Focus />
          <Control />
        </Pair>
      </Stack>
      <Lock zoom={1.1} />
      <Island />
    </div>
  </div>
);

const Square = () => (
  <div className="grid" style={rows(440, 440, 264)}>
    <div className="grid min-h-0" style={columns(768, 544)}>
      <Week />
      <TodayPlan />
    </div>
    <div className="grid min-h-0" style={columns(408, 568, 320)}>
      <TodayLarge />
      <Lock zoom={1} />
      <Stack>
        <Focus />
        <Control />
      </Stack>
    </div>
    <div className="grid min-h-0" style={columns(408, 904)}>
      <Upcoming />
      <Island row />
    </div>
  </div>
);

export const Bento = ({ shape }: { shape: BentoShape }) => (
  <Fit width={BENTO[shape].width} className="rounded-2xl">
    <div
      role="img"
      aria-label={`LifeOS widgets for iPhone and Mac, ${shape === "wide" ? "16 by 9" : "square"}`}
      data-bento={shape}
      className={cn("flex flex-col bg-background text-foreground", shape === "wide" ? "px-16 pt-10 pb-16" : "px-14 pt-8 pb-14")}
      style={BENTO[shape]}
    >
      <Masthead stacked={shape === "square"} />
      {shape === "wide" ? <Wide /> : <Square />}
    </div>
  </Fit>
);

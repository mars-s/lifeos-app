"use client";

import { Camera, Flashlight, Hourglass, Pause, Stop, Timer, Tray, WifiHigh, BluetoothConnected, Moon, AirplaneTilt, type Icon } from "@phosphor-icons/react";
import { useContext, type CSSProperties, type ReactNode } from "react";
import { LifeosMark } from "@/components/lifeos/mark";
import { formatClock, formatMinutes } from "@/components/lifeos/format";
import { cn } from "@/lib/utils";
import { ThemeContext } from "../theme";
import type { Mode } from "./model";
import { Axis, DayStrip, DotNumber, DotRing, Fit, FocusStrip, MODE_VARS, ModeContext, wallpaperFor, WallpaperImage, type Wallpaper } from "./parts";
import { AREAS, BRAIN_DUMP, CAPACITY, FOCUS, NEXT, NOW, PLANNED, SPANS, TASKS } from "./sample";
import { CapacityWidget, FocusWidget, NEXT_WINDOW, NextUpWidget, TodayWidget } from "./tiles";

const SCREEN = { width: 390, height: 800 } as const;

const StatusBar = ({ ink }: { ink: string }) => (
  <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 z-30 flex h-12 items-end justify-between px-9 pb-1", ink)}>
    <span className="text-[0.9375rem] font-semibold">9:41</span>
    <span className="flex items-center gap-1.5">
      <span className="flex items-end gap-[2px]">
        {[4, 6, 8, 10].map((height) => (
          <span key={height} className="w-[3px] rounded-[1px] bg-current" style={{ height }} />
        ))}
      </span>
      <span className="relative h-3 w-6 rounded-[4px] opacity-90 shadow-[inset_0_0_0_1px] shadow-current">
        <span className="absolute inset-[2px] right-[5px] rounded-[2px] bg-current" />
      </span>
    </span>
  </div>
);

const Phone = ({ label, wallpaper, dim = 0, island, children }: { label: string; wallpaper: Wallpaper; dim?: number; island?: ReactNode; children: ReactNode }) => (
  <Fit width={SCREEN.width}>
    <div role="group" aria-label={label} className={cn("relative isolate overflow-hidden rounded-[3rem] shadow-lift ring-1 ring-foreground/[0.09]", wallpaper === "morning" ? "text-[oklch(0.3_0.01_70)]" : "text-white")} style={SCREEN}>
      <WallpaperImage wallpaper={wallpaper} dim={dim} />
      <StatusBar ink={wallpaper === "morning" ? "text-[oklch(0.3_0.01_70)]" : "text-white"} />
      <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2">{island ?? <span aria-hidden="true" className="block h-[2.125rem] w-[7.5rem] rounded-full bg-black" />}</div>
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-1/2 z-30 h-[5px] w-[8.5rem] -translate-x-1/2 rounded-full bg-current opacity-80" />
    </div>
  </Fit>
);

const ICON_GLASS: CSSProperties = {
  background: "rgb(255 255 255 / 0.2)",
  backdropFilter: "blur(18px) saturate(1.4)",
  WebkitBackdropFilter: "blur(18px) saturate(1.4)",
  boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.3), inset 0 0 0 0.5px rgb(255 255 255 / 0.14)",
};

const AppIcon = ({ children }: { children?: ReactNode }) => (
  <span aria-hidden="true" className="grid size-[3.75rem] place-items-center rounded-[1.0625rem] text-white/90" style={ICON_GLASS}>
    {children}
  </span>
);

export const HomeScreen = ({ mode }: { mode: Extract<Mode, "colour" | "tinted" | "clear"> }) => {
  const theme = useContext(ThemeContext);
  const glass = mode !== "colour";
  return (
    <div className={glass ? "dark" : theme}>
      <Phone
        label={`iPhone Home Screen, ${mode === "colour" ? theme : mode}`}
        wallpaper={glass ? "dusk" : wallpaperFor(theme)}
        dim={mode === "tinted" ? 0.42 : 0}
      >
        <ModeContext value={mode}>
          <div className="absolute inset-x-[1.4375rem] top-[4.25rem] flex flex-col gap-5">
            <TodayWidget />
            <div className="flex justify-between">
              <CapacityWidget />
              <NextUpWidget />
            </div>
            <div className="grid grid-cols-4 justify-items-center gap-y-6 pt-2">
              {Array.from({ length: 8 }, (_, index) => (
                <AppIcon key={index} />
              ))}
            </div>
          </div>
        </ModeContext>
        <div className="absolute inset-x-3 bottom-5 flex h-[5.5rem] items-center justify-around rounded-[2.25rem] px-2" style={ICON_GLASS}>
          <AppIcon>
            <LifeosMark />
          </AppIcon>
          <AppIcon />
          <AppIcon />
          <AppIcon />
        </div>
      </Phone>
    </div>
  );
};

const Accessory = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div
    role="group"
    aria-label={label}
    className={cn("relative grid size-[4.5rem] shrink-0 place-items-center rounded-full bg-white/[0.14] text-(--w-ink) backdrop-blur-md", className)}
    style={MODE_VARS.vibrant}
  >
    {children}
  </div>
);

export const CapacityCircle = () => (
  <Accessory label={`Capacity: ${formatMinutes(CAPACITY - PLANNED)} free`}>
    <DotRing total={30} filled={Math.round((PLANNED / CAPACITY) * 30)} size={72} dot={1.75} />
    <span className="flex flex-col items-center leading-none">
      <span className="font-mono text-[0.9375rem] font-semibold">{formatMinutes(CAPACITY - PLANNED)}</span>
      <span className="mt-0.5 text-[0.625rem] text-(--w-dim)">free</span>
    </span>
  </Accessory>
);

export const BrainDumpCircle = () => (
  <Accessory label={`Brain Dump: ${BRAIN_DUMP} to sort. Tap to add`}>
    <span className="flex flex-col items-center leading-none">
      <Tray weight="fill" className="size-5" aria-hidden="true" />
      <span className="mt-1 font-mono text-[0.8125rem] font-semibold">+{BRAIN_DUMP}</span>
    </span>
  </Accessory>
);

export const TodayCircle = () => (
  <Accessory label={`Today: ${TASKS.length} Tasks left`}>
    <DotNumber value={String(TASKS.length)} pitch={4.2} label={`${TASKS.length} left`} />
  </Accessory>
);

export const NextUpRectangle = () => (
  <div role="group" aria-label={`Next up: ${NEXT.task.title} at ${formatClock(NEXT.start)}`} className="w-[10.25rem] shrink-0 text-(--w-ink)" style={MODE_VARS.vibrant}>
    <ModeContext value="vibrant">
      <p className="truncate text-[0.9375rem] leading-5 font-semibold">{NEXT.task.title}</p>
      <p className="truncate text-small leading-4 text-(--w-dim)">
        <span className="font-mono">{formatClock(NEXT.start)}</span>, {NEXT.place}
      </p>
      <div className="mt-2">
        <DayStrip start={NEXT_WINDOW.start} end={NEXT_WINDOW.end} now={NOW} spans={SPANS} step={15} />
        <Axis left={`leave ${formatClock(NEXT.leave)}`} right={formatClock(NEXT_WINDOW.end)} />
      </div>
    </ModeContext>
  </div>
);

export const InlineAccessory = () => (
  <p className="flex items-center justify-center gap-1.5 text-[1.0625rem] font-medium text-white/90">
    <Hourglass weight="fill" className="size-4" aria-hidden="true" />
    <span>
      <span className="font-mono">{formatMinutes(CAPACITY - PLANNED)}</span> free, <span className="font-mono">{TASKS.length}</span> left
    </span>
  </p>
);

const RoundControl = ({ icon: IconComponent, label, className }: { icon: Icon; label: string; className?: string }) => (
  <button
    type="button"
    aria-label={label}
    className={cn(
      "grid size-9 shrink-0 touch-manipulation place-items-center rounded-full bg-white/[0.16] text-white outline-none transition-[scale,background-color] duration-(--dur-press) ease-out hover:bg-white/[0.24] focus-visible:shadow-[0_0_0_2px_rgb(255_255_255/0.7)] active:scale-[0.92] motion-reduce:transition-none",
      className,
    )}
  >
    <IconComponent weight="fill" className="size-4" aria-hidden="true" />
  </button>
);

const FocusTitle = () => (
  <div className="min-w-0 flex-1">
    <p className="flex items-center gap-1.5 text-micro text-(--w-dim)">
      <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: `var(--area-${AREAS[FOCUS.area].colour})` }} />
      {AREAS[FOCUS.area].name}
    </p>
    <p className="truncate text-[0.9375rem] leading-5 font-semibold">{FOCUS.task}</p>
    <p className="text-micro text-(--w-dim)">
      Pomodoro <span className="font-mono">{FOCUS.round}</span> of <span className="font-mono">{FOCUS.rounds}</span>
    </p>
  </div>
);

const FocusControls = () => (
  <div className="mt-3 flex items-center gap-3">
    <div className="min-w-0 flex-1">
      <FocusStrip total={FOCUS.planned} elapsed={FOCUS.elapsed} />
      <Axis left="0" right="25:00" />
    </div>
    <RoundControl icon={Pause} label="Pause the Focus Session" />
    <RoundControl icon={Stop} label="Stop the Focus Session" />
  </div>
);

export const LiveActivity = ({ className }: { className?: string }) => (
  <div
    role="group"
    aria-label={`Live Activity: Focus Session on ${FOCUS.task}, ${FOCUS.left} left`}
    className={cn("dark rounded-[1.75rem] bg-[rgb(22_22_24/0.72)] p-4 text-(--w-ink) shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.1)] backdrop-blur-2xl", className)}
    style={MODE_VARS.clear}
  >
    <ModeContext value="clear">
      <div className="flex items-center gap-3">
        <FocusTitle />
        <DotNumber value={FOCUS.left} pitch={4.4} label={`${FOCUS.left} left`} />
      </div>
      <FocusControls />
    </ModeContext>
  </div>
);

export const IslandCompact = () => (
  <div role="group" aria-label={`Dynamic Island, compact: ${FOCUS.left} left`} className="flex h-[2.3125rem] w-[12.25rem] items-center justify-between rounded-full bg-black px-3 text-white" style={MODE_VARS.standby}>
    <span className="relative grid size-6 place-items-center">
      <DotRing total={12} filled={3} size={24} dot={1.4} />
    </span>
    <span className="font-mono text-small font-medium">{FOCUS.left}</span>
  </div>
);

export const IslandMinimal = () => (
  <div role="group" aria-label="Dynamic Island, minimal: a quarter of the Focus Session done" className="relative grid size-[2.3125rem] place-items-center rounded-full bg-black text-white" style={MODE_VARS.standby}>
    <DotRing total={12} filled={3} size={37} dot={1.6} />
    <Timer weight="fill" className="size-3" aria-hidden="true" />
  </div>
);

export const IslandExpanded = () => (
  <div
    role="group"
    aria-label={`Dynamic Island, expanded: Focus Session on ${FOCUS.task}`}
    className="dark w-[22.875rem] rounded-[2.75rem] bg-black px-5 pt-4 pb-5 text-(--w-ink)"
    style={MODE_VARS.standby}
  >
    <ModeContext value="standby">
      <div className="flex items-center gap-3">
        <FocusTitle />
        <DotNumber value={FOCUS.left} pitch={4.4} label={`${FOCUS.left} left`} />
      </div>
      <FocusControls />
    </ModeContext>
  </div>
);

export const LockScreen = () => (
  <div className="dark">
    <Phone label="iPhone Lock Screen" wallpaper="night" island={<IslandCompact />}>
      <div className="absolute inset-x-0 top-[5.25rem] text-center text-white">
        <InlineAccessory />
        <p aria-hidden="true" className="mt-1 text-[6rem] leading-none font-semibold tracking-[-0.04em] text-white/90">
          9:41
        </p>
      </div>
      <div className="absolute inset-x-6 top-[14.75rem] flex items-center justify-between">
        <NextUpRectangle />
        <CapacityCircle />
        <BrainDumpCircle />
      </div>
      <LiveActivity className="absolute inset-x-3 bottom-[6.5rem]" />
      <div aria-hidden="true" className="absolute inset-x-11 bottom-9 flex justify-between text-white">
        {[Flashlight, Camera].map((IconComponent, index) => (
          <span key={index} className="grid size-[3.125rem] place-items-center rounded-full bg-white/[0.16] backdrop-blur-md">
            <IconComponent weight="fill" className="size-5" />
          </span>
        ))}
      </div>
    </Phone>
  </div>
);

export const StandBy = ({ night = false }: { night?: boolean }) => {
  const mode = night ? "night" : "standby";
  return (
    <Fit width={620}>
      <div
        role="group"
        aria-label={night ? "StandBy at night" : "StandBy"}
        className="dark flex h-[18.5rem] items-center justify-center gap-10 rounded-[2.75rem] bg-black ring-1 ring-foreground/[0.09]"
      >
        <ModeContext value={mode}>
          <div style={{ zoom: 1.5 }}>
            <CapacityWidget />
          </div>
          <div style={{ zoom: 1.5 }}>
            <FocusWidget />
          </div>
        </ModeContext>
      </div>
    </Fit>
  );
};

const CONTROL_GLASS = "bg-white/[0.16] backdrop-blur-xl shadow-[inset_0_1px_0_rgb(255_255_255/0.22)]";

const ControlButton = ({ icon: IconComponent, label, on = false }: { icon: Icon; label: string; on?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={on}
    className={cn(
      "grid size-[4.25rem] touch-manipulation place-items-center rounded-full outline-none transition-[scale,opacity] duration-(--dur-press) ease-out hover:opacity-85 focus-visible:shadow-[0_0_0_2px_rgb(255_255_255/0.7)] active:scale-[0.94] motion-reduce:transition-none",
      on ? "bg-white text-black" : cn(CONTROL_GLASS, "text-white"),
    )}
  >
    <IconComponent weight="fill" className="size-6" aria-hidden="true" />
  </button>
);

export const BrainDumpButton = () => <ControlButton icon={Tray} label="Brain Dump: add a thought" />;

export const BrainDumpControl = ({ className }: { className?: string }) => (
  <button
    type="button"
    className={cn(
      "flex h-[4.25rem] touch-manipulation items-center gap-3 rounded-full px-4 text-left text-white outline-none transition-[scale,opacity] duration-(--dur-press) ease-out hover:opacity-85 focus-visible:shadow-[0_0_0_2px_rgb(255_255_255/0.7)] active:scale-[0.96] motion-reduce:transition-none",
      CONTROL_GLASS,
      className,
    )}
  >
    <Tray weight="fill" className="size-5 shrink-0" aria-hidden="true" />
    <span className="min-w-0">
      <span className="block truncate text-small leading-4 font-semibold">Brain Dump</span>
      <span className="block truncate text-micro text-white/65">
        <span className="font-mono">{BRAIN_DUMP}</span> to sort
      </span>
    </span>
  </button>
);

export const ControlCentre = () => (
  <Fit width={332}>
    <div role="group" aria-label="Control Centre" className="dark relative isolate overflow-hidden rounded-[2.5rem] p-5">
      <WallpaperImage wallpaper="night" dim={0.35} />
      <div className="grid grid-cols-4 gap-x-3 gap-y-4">
        <div aria-hidden="true" className={cn("col-span-2 row-span-2 grid grid-cols-2 place-items-center gap-2 rounded-[2rem] p-3", CONTROL_GLASS)}>
          {[AirplaneTilt, WifiHigh, BluetoothConnected, Moon].map((IconComponent, index) => (
            <span key={index} className="grid size-12 place-items-center rounded-full bg-white/[0.14] text-white/80">
              <IconComponent weight="fill" className="size-5" />
            </span>
          ))}
        </div>
        <BrainDumpButton />
        <ControlButton icon={Timer} label="Focus Session, running" on />
        <BrainDumpControl className="col-span-2" />
      </div>
    </div>
  </Fit>
);

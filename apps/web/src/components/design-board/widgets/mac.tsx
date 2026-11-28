"use client";

import { useContext } from "react";
import { LifeosMark } from "@/components/lifeos/mark";
import { cn } from "@/lib/utils";
import { ThemeContext } from "../theme";
import { Fit, ModeContext, wallpaperFor, WallpaperImage } from "./parts";
import { DATE, TASKS } from "./sample";
import { CapacityWidget, FocusWidget, NextUpWidget, TodayWidget, WeekWidget } from "./tiles";

const DESKTOP = { width: 1160, height: 700 } as const;
const BAR = "bg-[light-dark(rgb(255_255_255/0.5),rgb(30_30_32/0.5))] backdrop-blur-2xl";

const MenuBar = ({ front }: { front: boolean }) => (
  <div aria-hidden="true" className={cn("flex h-7 items-center gap-5 px-4 text-small text-foreground", BAR)}>
    <span className="font-semibold">{front ? "LifeOS" : "Finder"}</span>
    {["File", "Edit", "View", "Window", "Help"].map((item) => (
      <span key={item}>{item}</span>
    ))}
    <span className="ml-auto">{DATE}</span>
    <span className="font-mono">9:41</span>
  </div>
);

const Dock = () => (
  <div aria-hidden="true" className={cn("absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-[1.375rem] p-2 shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.2)]", BAR)}>
    {Array.from({ length: 7 }, (_, index) => (
      <span key={index} className="grid size-11 place-items-center rounded-xl bg-foreground/[0.1] text-foreground">
        {index === 2 && <LifeosMark />}
      </span>
    ))}
  </div>
);

const AppWindow = ({ shown }: { shown: boolean }) => (
  <div
    aria-hidden="true"
    inert
    className={cn(
      "absolute top-[5.5rem] right-10 flex h-[30rem] w-[41rem] origin-bottom overflow-hidden rounded-xl bg-background shadow-float ring-1 ring-foreground/[0.08] transition-[opacity,scale] duration-(--dur-base) ease-out motion-reduce:transition-none",
      shown ? "opacity-100" : "pointer-events-none scale-[0.97] opacity-0",
    )}
  >
    <div className="flex w-44 shrink-0 flex-col gap-1 bg-surface p-3">
      <span className="mb-3 flex gap-1.5">
        {[0, 1, 2].map((light) => (
          <span key={light} className="size-2.5 rounded-full bg-foreground/15" />
        ))}
      </span>
      {["Brain Dump", "Today", "Upcoming", "Anytime", "Someday"].map((row) => (
        <span key={row} className={cn("rounded-md px-2 py-1 text-small", row === "Today" ? "bg-foreground/[0.08] font-medium text-foreground" : "text-muted-foreground")}>
          {row}
        </span>
      ))}
    </div>
    <div className="min-w-0 flex-1 p-8">
      <p className="text-title font-semibold">Today</p>
      <p className="mt-1 text-small text-muted-foreground">{DATE}</p>
      <ul className="mt-6 space-y-3">
        {TASKS.map((task) => (
          <li key={task.id} className="flex items-center gap-3 text-body">
            <span className="size-[1.125rem] rounded-[6px] shadow-[inset_0_0_0_1.5px_var(--faint-foreground)]" />
            {task.title}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

export const MacDesktop = ({ front }: { front: boolean }) => {
  const theme = useContext(ThemeContext);
  return (
    <Fit width={DESKTOP.width} className={theme}>
      <div
        role="group"
        aria-label={front ? "Mac desktop with LifeOS in front, widgets dimmed" : "Mac desktop with widgets"}
        className="relative isolate overflow-hidden rounded-[1.25rem] ring-1 ring-foreground/[0.09]"
        style={DESKTOP}
      >
        <WallpaperImage wallpaper={wallpaperFor(theme)} />
        <MenuBar front={front} />
        <ModeContext value={front ? "desktop" : "colour"}>
          <div className="absolute top-12 left-12 flex flex-col gap-4">
            <div className="flex gap-4">
              <WeekWidget />
              <TodayWidget size="large" />
            </div>
            <div className="flex gap-4">
              <NextUpWidget size="medium" />
              <CapacityWidget />
              <FocusWidget />
            </div>
          </div>
        </ModeContext>
        <AppWindow shown={front} />
        <Dock />
      </div>
    </Fit>
  );
};

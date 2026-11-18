import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AreaColour } from "./area";
import { DotMatrix } from "./dot-matrix";

export const SPOTS = [
  "today-clear",
  "inbox-empty",
  "upcoming",
  "anytime",
  "someday",
  "logbook",
  "planning",
  "focus",
  "shutdown",
  "done",
] as const;
export type Spot = (typeof SPOTS)[number];

export const BACKDROPS = ["dawn", "morning", "afternoon", "dusk", "night"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

const DARK_BACKDROPS: ReadonlySet<Backdrop> = new Set(["dusk", "night"]);
export const backdropIsDark = (backdrop: Backdrop, set: BackdropSet = "room") =>
  set === "blur" ? backdrop !== "morning" : DARK_BACKDROPS.has(backdrop);

export const backdropForHour = (hour: number) =>
  (hour < 5 ? "night" : hour < 8 ? "dawn" : hour < 14 ? "morning" : hour < 18 ? "afternoon" : hour < 21 ? "dusk" : "night") satisfies Backdrop;

const EDGE_FADE = "[mask-image:radial-gradient(ellipse_at_center,black_58%,transparent_72%)]";

export const SpotArt = ({ spot, className }: { spot: Spot; className?: string }) => (
  <span aria-hidden="true" className={cn("relative block aspect-[3/2] w-56 shrink-0", className)}>
    <img
      src={`/art/spots/light/${spot}.webp`}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn("absolute inset-0 size-full object-contain mix-blend-multiply select-none dark:hidden", EDGE_FADE)}
    />
    <img
      src={`/art/spots/dark/${spot}.webp`}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn("absolute inset-0 hidden size-full object-contain mix-blend-screen select-none dark:block", EDGE_FADE)}
    />
  </span>
);

export const BACKDROP_SETS = ["blur", "painted", "room"] as const;
export type BackdropSet = (typeof BACKDROP_SETS)[number];

const BACKDROP_FOLDER = { room: "backdrops", painted: "painted", blur: "blur" } as const satisfies Record<BackdropSet, string>;

export const RITUALS = ["planning", "focus", "shutdown", "inbox", "someday", "done"] as const;
export type Ritual = (typeof RITUALS)[number];

const TILE = "block aspect-square shrink-0 rounded-[18%] object-cover select-none";

export const AreaCover = ({ colour, className }: { colour: AreaColour; className?: string }) => (
  <img src={`/art/covers/${colour}.webp`} alt="" loading="lazy" draggable={false} className={cn(TILE, "size-24", className)} />
);

export const RitualArt = ({ ritual, className }: { ritual: Ritual; className?: string }) => (
  <img src={`/art/rituals/${ritual}.webp`} alt="" loading="lazy" draggable={false} className={cn(TILE, "size-40", className)} />
);

export const BackdropScene = ({
  backdrop,
  set = "room",
  children,
  className,
}: {
  backdrop: Backdrop;
  set?: BackdropSet;
  children?: ReactNode;
  className?: string;
}) => (
  <div className={cn("relative isolate overflow-hidden bg-surface", className)}>
    {BACKDROPS.map((name) => (
      <img
        key={`${set}-${name}`}
        src={`/art/${BACKDROP_FOLDER[set]}/${name}.webp`}
        alt=""
        loading="lazy"
        draggable={false}
        className={cn(
          "absolute inset-0 -z-10 size-full object-cover object-bottom transition-opacity duration-700 ease-out select-none motion-reduce:duration-0",
          set === "blur" && "object-center",
          name === backdrop ? "opacity-100" : "opacity-0",
        )}
      />
    ))}
    {set === "blur" && (
      <DotMatrix
        key={backdrop}
        src={`/art/blur/${backdrop}.webp`}
        tone={backdropIsDark(backdrop, set) ? "light" : "dark"}
        className="-z-10"
      />
    )}
    {children}
  </div>
);

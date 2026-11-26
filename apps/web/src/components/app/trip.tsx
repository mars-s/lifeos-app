"use client";

import { ArrowSquareOut, CaretDown, MapPin, X } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { TRIP_LOOK_LIMIT_MS, type TravelMode } from "@lifeos/backend/features";
import type { PlannerTask, TripView } from "@lifeos/backend/types";
import { AiMarkWorking } from "@/components/lifeos/ai-mark";
import { GlimmBand } from "@/components/lifeos/glimm-band";
import { ToolButton } from "@/components/lifeos/tool-button";
import { Button } from "@/components/ui/action-button";
import { instant, springLayout } from "@/lib/motion-tokens";
import { useChange } from "./changes";
import { isDraftTask } from "./drafts";
import { useQuietView } from "./hooks";

const TripMap = lazy(() => import("./trip-map"));

type Trip = Extract<TripView, { kind: "trip" }>;
type Looking = Extract<TripView, { kind: "looking" }>;
type Place = Trip["places"][number];

const MODE_WORDS = { drive: "drive", walk: "walk", cycle: "ride" } satisfies Record<TravelMode, string>;
const APPLE_MAPS_FLAG = { drive: "d", walk: "w", cycle: "d" } satisfies Record<TravelMode, string>;

const kilometres = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

export const placeLabel = (place: Place) => (place.suburb ? `${place.name}, ${place.suburb}` : place.name);

const distanceOf = (place: Place) => {
  const metres = place.travel?.metres ?? place.straightMetres;
  return metres < 1000 ? `${Math.round(metres / 10) * 10}\u00a0m` : `${kilometres.format(metres / 1000)}\u00a0km`;
};

const minutesOf = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes}\u00a0min` : `${Math.floor(minutes / 60)}\u00a0h ${minutes % 60}\u00a0min`;
};

const mapsHref = (place: Place, mode: TravelMode) =>
  `https://maps.apple.com/?${new URLSearchParams({
    daddr: `${place.position.lat},${place.position.lon}`,
    q: place.name,
    dirflg: APPLE_MAPS_FLAG[mode],
  }).toString()}`;

const Figures = ({ place, mode }: { place: Place; mode: TravelMode }) => (
  <span className="text-small whitespace-nowrap text-muted-foreground">
    <span className="font-mono text-foreground tabular-nums">{distanceOf(place)}</span>
    {place.travel && (
      <>
        {" · "}
        <span className="font-mono text-foreground tabular-nums">{minutesOf(place.travel.seconds)}</span> {MODE_WORDS[mode]}
      </>
    )}
  </span>
);

const ARTICLE = /^an? /;

const titleCase = (text: string) => text.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => `${space}${letter.toUpperCase()}`);

const placeWords = (query: string) => (ARTICLE.test(query) ? query.replace(ARTICLE, "") : titleCase(query));

const STREETS = [
  { d: "M-10 98C60 82 130 112 330 72", width: 10 },
  { d: "M92-10 132 160", width: 8 },
  { d: "M212-10c-10 60 40 100 30 170", width: 6 },
  { d: "M-10 42 330 30", width: 4 },
] as const;

const Streets = ({ looking }: { looking: boolean }) => (
  <svg aria-hidden="true" viewBox="0 0 320 144" preserveAspectRatio="xMidYMid slice" fill="none" strokeLinecap="round" className="absolute inset-0 size-full">
    {STREETS.map(({ d, width }) => (
      <path key={d} d={d} strokeWidth={width} className="stroke-foreground/[0.05]" />
    ))}
    {looking && (
      <>
        <circle cx="118" cy="97" r="4.5" className="fill-foreground/70 stroke-popover" strokeWidth="2" />
        <circle cx="226" cy="60" r="7" strokeWidth="1.5" strokeDasharray="3 3" className="stroke-brand/70 motion-safe:animate-pending" />
      </>
    )}
  </svg>
);

const LookingRow = ({ query }: { query: string }) => (
  <div className="flex items-start gap-2 motion-safe:animate-fade-in">
    <AiMarkWorking weight="bold" className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p role="status" className="truncate text-small font-medium">
        Finding the nearest <span translate="no">{placeWords(query)}</span>…
      </p>
      <span aria-hidden="true" className="text-small">
        <span className="inline-block h-2 w-28 rounded-full bg-foreground/[0.07] align-middle motion-safe:animate-pending" />
      </span>
    </div>
  </div>
);

const withChoice = (taskId: Id<"tasks">, choose: (trip: Trip) => TripView | null) => (store: OptimisticLocalStore) => {
  const trip = store.getQuery(api.places.trips.forTask, { taskId });
  if (trip?.kind === "trip") store.setQuery(api.places.trips.forTask, { taskId }, choose(trip));
};

const TripDetails = ({ taskId, trip, onPick }: { taskId: Id<"tasks">; trip: Trip; onPick: (place: Place) => void }) => {
  const change = useChange();
  const reduce = useReducedMotion();
  const listId = useId();
  const [showingOthers, setShowingOthers] = useState(false);
  const others = trip.places.filter((place) => place.key !== trip.chosen.key);
  const dismiss = () =>
    void change({
      title: "Trip dismissed",
      mutation: api.places.trips.dismiss,
      args: { taskId },
      apply: withChoice(taskId, () => null),
      revert: (store) => store.setQuery(api.places.trips.forTask, { taskId }, trip),
      slot: `trip:${taskId}`,
    });

  return (
    <>
      <div className="flex items-start gap-2 motion-safe:animate-fade-in">
        <MapPin weight="fill" className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-small font-medium" translate="no">
            {trip.chosen.name}
            {trip.chosen.suburb && <span className="font-normal text-muted-foreground"> {trip.chosen.suburb}</span>}
          </p>
          <Figures place={trip.chosen} mode={trip.mode} />
          <a
            href={mapsHref(trip.chosen, trip.mode)}
            target="_blank"
            rel="noreferrer"
            className="-ml-2 flex h-7 w-fit items-center gap-1 rounded-full px-2 text-small text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
          >
            Open in Maps
            <ArrowSquareOut className="size-3.5" aria-hidden="true" />
          </a>
        </div>
        <span className="-mt-1 -mr-1.5 flex shrink-0 items-center gap-0.5">
          {others.length > 0 && (
            <ToolButton
              icon={CaretDown}
              label="Other branches"
              aria-expanded={showingOthers}
              aria-controls={listId}
              onClick={() => setShowingOthers((open) => !open)}
            />
          )}
          <ToolButton icon={X} label="Dismiss" onClick={dismiss} />
        </span>
      </div>
      <AnimatePresence initial={false}>
        {showingOthers && (
          <motion.ul
            id={listId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? instant : springLayout}
            className="overflow-hidden pl-4"
          >
            {others.map((place) => (
              <li key={place.key}>
                <button
                  type="button"
                  onClick={() => {
                    setShowingOthers(false);
                    onPick(place);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-[background-color,scale] duration-(--dur-press) ease-out outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]"
                >
                  <span className="min-w-0 flex-1 truncate text-small" translate="no">
                    {place.name}
                    {place.suburb && <span className="text-muted-foreground"> {place.suburb}</span>}
                  </span>
                  <Figures place={place} mode={trip.mode} />
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </>
  );
};

const TripPanel = ({ taskId, view }: { taskId: Id<"tasks">; view: Trip | Looking }) => {
  const change = useChange();
  const trip = view.kind === "trip" ? view : undefined;
  const pick = (place: Place) => {
    if (!trip) return;
    void change({
      title: `Going to ${placeLabel(place)}`,
      mutation: api.places.trips.choose,
      args: { taskId, key: place.key },
      apply: withChoice(taskId, (current) => ({ ...current, chosen: place })),
      revert: withChoice(taskId, (current) => ({ ...current, chosen: trip.chosen })),
      slot: `trip:${taskId}`,
    });
  };
  return (
    <section aria-label={trip ? `Trip to ${placeLabel(trip.chosen)}` : "Finding a trip"} aria-busy={!trip} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="relative h-36 overflow-hidden rounded-lg bg-foreground/[0.04]">
        <Streets looking={!trip} />
        {trip && (
          <div className="absolute inset-0 motion-safe:animate-fade-in">
            <Suspense fallback={null}>
              <TripMap trip={trip} onPick={pick} />
            </Suspense>
          </div>
        )}
        <GlimmBand working={!trip} reveal={trip !== undefined} className="rounded-lg" />
      </div>
      {trip ? <TripDetails taskId={taskId} trip={trip} onPick={pick} /> : <LookingRow query={view.query} />}
    </section>
  );
};

const useOverdue = (since: number | undefined) => {
  const [overdue, setOverdue] = useState<number>();
  useEffect(() => {
    if (since === undefined) return;
    const timer = setTimeout(() => setOverdue(since), Math.max(0, since + TRIP_LOOK_LIMIT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [since]);
  return since !== undefined && overdue === since;
};

const lookAgain = (store: OptimisticLocalStore, { taskId }: { taskId: Id<"tasks"> }) => {
  const current = store.getQuery(api.places.trips.forTask, { taskId });
  if (current?.kind === "failed" || current?.kind === "looking")
    store.setQuery(api.places.trips.forTask, { taskId }, { kind: "looking", query: current.query, since: Date.now() });
};

const LINE = "ml-0.5 flex items-center gap-2 text-small text-muted-foreground";

export const TaskTrip = ({ task }: { task: PlannerTask }) => {
  const live = task.status.kind === "open" && !isDraftTask(task._id);
  const reduce = useReducedMotion();
  const trip = useQuietView(api.places.trips.forTask, live ? { taskId: task._id } : "skip");
  const ask = useMutation(api.places.trips.request);
  const request = useMemo(() => ask.withOptimisticUpdate(lookAgain), [ask]);
  useEffect(() => {
    if (live) request({ taskId: task._id }).catch(() => undefined);
  }, [live, request, task._id]);
  const overdue = useOverdue(trip?.kind === "looking" ? trip.since : undefined);
  const view = trip?.kind === "looking" && overdue ? { kind: "failed" as const, query: trip.query } : trip;
  return (
    <AnimatePresence initial={false}>
      {view && (
        <motion.div
          key={view.kind === "trip" || view.kind === "looking" ? "panel" : view.kind}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduce ? instant : springLayout}
          className="-m-1 overflow-hidden p-1"
        >
          {(view.kind === "trip" || view.kind === "looking") && <TripPanel taskId={task._id} view={view} />}
          {view.kind === "unfound" && (
            <p className={LINE}>
              <MapPin className="size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
              No {view.query} within 15 km of home.
            </p>
          )}
          {view.kind === "failed" && (
            <div className={LINE}>
              <MapPin className="size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
              <p role="status" className="min-w-0 flex-1 text-pretty">
                Could not find the nearest <span translate="no">{placeWords(view.query)}</span> just now.
              </p>
              <Button variant="quiet" onClick={() => void request({ taskId: task._id }).catch(() => undefined)}>
                Try again
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

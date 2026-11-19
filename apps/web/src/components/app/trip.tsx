"use client";

import { ArrowSquareOut, CaretDown, MapPin, X } from "@phosphor-icons/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { TravelMode } from "@lifeos/backend/features";
import type { PlannerTask, TripView } from "@lifeos/backend/types";
import { ToolButton } from "@/components/lifeos/tool-button";
import { instant, springLayout } from "@/lib/motion-tokens";
import { useChange } from "./changes";
import { isDraftTask } from "./drafts";
import { useQuietView } from "./hooks";

const TripMap = lazy(() => import("./trip-map"));

type Trip = Extract<TripView, { kind: "trip" }>;
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

const withChoice = (taskId: Id<"tasks">, choose: (trip: Trip) => TripView | null) => (store: OptimisticLocalStore) => {
  const trip = store.getQuery(api.places.trips.forTask, { taskId });
  if (trip?.kind === "trip") store.setQuery(api.places.trips.forTask, { taskId }, choose(trip));
};

const MapFallback = () => <div aria-hidden="true" className="h-36 rounded-lg bg-foreground/[0.04]" />;

const TripPanel = ({ taskId, trip }: { taskId: Id<"tasks">; trip: Trip }) => {
  const change = useChange();
  const reduce = useReducedMotion();
  const listId = useId();
  const [showingOthers, setShowingOthers] = useState(false);
  const others = trip.places.filter((place) => place.key !== trip.chosen.key);
  const pick = (place: Place) => {
    setShowingOthers(false);
    void change({
      title: `Going to ${placeLabel(place)}`,
      mutation: api.places.trips.choose,
      args: { taskId, key: place.key },
      apply: withChoice(taskId, (current) => ({ ...current, chosen: place })),
      revert: withChoice(taskId, (current) => ({ ...current, chosen: trip.chosen })),
      slot: `trip:${taskId}`,
    });
  };
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
    <section aria-label={`Trip to ${placeLabel(trip.chosen)}`} className="-ml-1 grid gap-2">
      <Suspense fallback={<MapFallback />}>
        <TripMap trip={trip} onPick={pick} />
      </Suspense>
      <div className="flex items-start gap-2 pl-1">
        <MapPin weight="fill" className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-small font-medium" translate="no">
            {trip.chosen.name}
            {trip.chosen.suburb && <span className="font-normal text-muted-foreground"> {trip.chosen.suburb}</span>}
          </p>
          <Figures place={trip.chosen} mode={trip.mode} />
        </div>
        <span className="flex shrink-0 items-center gap-0.5">
          <a
            href={mapsHref(trip.chosen, trip.mode)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-small text-muted-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
          >
            Open in Maps
            <ArrowSquareOut className="size-3.5" aria-hidden="true" />
          </a>
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
            className="overflow-hidden pl-6"
          >
            {others.map((place) => (
              <li key={place.key}>
                <button
                  type="button"
                  onClick={() => pick(place)}
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
    </section>
  );
};

export const TaskTrip = ({ task }: { task: PlannerTask }) => {
  const live = task.status.kind === "open" && !isDraftTask(task._id);
  const trip = useQuietView(api.places.trips.forTask, live ? { taskId: task._id } : "skip");
  const request = useMutation(api.places.trips.request);
  useEffect(() => {
    if (live) request({ taskId: task._id }).catch(() => undefined);
  }, [live, request, task._id]);
  if (!trip) return null;
  if (trip.kind === "unfound")
    return (
      <p className="-ml-0.5 flex items-center gap-2 text-small text-muted-foreground">
        <MapPin className="size-4 shrink-0 text-faint-foreground" aria-hidden="true" />
        No {trip.query} within 15 km of home.
      </p>
    );
  return <TripPanel taskId={task._id} trip={trip} />;
};

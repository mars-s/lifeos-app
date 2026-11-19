"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { TripView } from "@lifeos/backend/types";
import { Map, MapMarker, MarkerContent } from "@/components/ui/map";
import { cn } from "@/lib/utils";
import { placeLabel } from "./trip";

type Trip = Extract<TripView, { kind: "trip" }>;
type Place = Trip["places"][number];

const STYLES = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const PADDING = 28;

const boundsOf = (fromLat: number, fromLon: number, toLat: number, toLon: number) =>
  [
    [Math.min(fromLon, toLon), Math.min(fromLat, toLat)],
    [Math.max(fromLon, toLon), Math.max(fromLat, toLat)],
  ] as [[number, number], [number, number]];

export default function TripMap({ trip, onPick }: { trip: Trip; onPick: (place: Place) => void }) {
  const map = useRef<MapLibreMap>(null);
  const { lat: fromLat, lon: fromLon } = trip.from;
  const { lat: toLat, lon: toLon } = trip.chosen.position;
  const bounds = boundsOf(fromLat, fromLon, toLat, toLon);

  useEffect(() => {
    map.current?.fitBounds(boundsOf(fromLat, fromLon, toLat, toLon), { padding: PADDING, maxZoom: 15, duration: 420 });
  }, [fromLat, fromLon, toLat, toLon]);

  return (
    <Map
      ref={map}
      styles={STYLES}
      bounds={bounds}
      fitBoundsOptions={{ padding: PADDING, maxZoom: 15 }}
      interactive={false}
      attributionControl={{ compact: true }}
      className="trip-map h-full overflow-hidden rounded-lg [&>.z-10]:hidden"
    >
      <MapMarker longitude={trip.from.lon} latitude={trip.from.lat}>
        <MarkerContent>
          <span aria-label="Home" className="block size-2.5 rounded-full bg-foreground ring-2 ring-popover" />
        </MarkerContent>
      </MapMarker>
      {trip.places.map((place) => {
        const chosen = place.key === trip.chosen.key;
        return (
          <MapMarker key={place.key} longitude={place.position.lon} latitude={place.position.lat}>
            <MarkerContent>
              {chosen ? (
                <span aria-label={placeLabel(place)} className="block size-3.5 rounded-full bg-brand shadow-float ring-[3px] ring-popover" />
              ) : (
                <button
                  type="button"
                  aria-label={`Go to ${placeLabel(place)} instead`}
                  onClick={() => onPick(place)}
                  className={cn(
                    "relative block size-2 rounded-full bg-foreground/35 ring-2 ring-popover transition-[background-color,scale] duration-(--dur-fast) ease-out",
                    "before:absolute before:-inset-2.5 hover:bg-brand/70 focus-visible:bg-brand focus-visible:ring-ring focus-visible:outline-none active:scale-[0.9]",
                  )}
                />
              )}
            </MarkerContent>
          </MapMarker>
        );
      })}
    </Map>
  );
}

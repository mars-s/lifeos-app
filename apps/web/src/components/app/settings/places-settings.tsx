"use client";

import { Bicycle, Briefcase, Car, GraduationCap, House, PersonSimpleWalk, type Icon } from "@phosphor-icons/react";
import { useAction } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@lifeos/backend/api";
import type { PlaceLabel, TravelMode } from "@lifeos/backend/features";
import type { SavePlaceError, SavedPlace } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { Segmented } from "@/components/ui/segmented-control";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";
import { useFeatures } from "./feature-state";
import { Problem, SettingsGroup, SettingsRow } from "./rows";

const PLACES = [
  { label: "home", title: "Home", icon: House, hint: "Every trip is worked out from here." },
  { label: "work", title: "Work", icon: Briefcase, hint: "Optional." },
  { label: "uni", title: "Uni", icon: GraduationCap, hint: "Optional." },
] as const satisfies readonly { label: PlaceLabel; title: string; icon: Icon; hint: string }[];

const MODES = [
  { value: "drive", label: "Drive", icon: Car },
  { value: "walk", label: "Walk", icon: PersonSimpleWalk },
  { value: "cycle", label: "Cycle", icon: Bicycle },
] as const satisfies readonly { value: TravelMode; label: string; icon: Icon }[];

const SAVE_PROBLEMS = {
  empty: () => "Type an address first.",
  not_found: () => "OpenStreetMap could not find that address. Try adding the suburb and postcode.",
  unreachable: () => "Could not reach OpenStreetMap. Try again in a moment.",
  unavailable: () => "OpenStreetMap did not answer. Try again in a moment.",
  invalid_response: () => "OpenStreetMap sent something LifeOS could not read. Try again in a moment.",
} satisfies { [K in SavePlaceError["kind"]]: () => string };

const AddressForm = ({ label, title, initial, onDone }: { label: PlaceLabel; title: string; initial: string; onDone?: () => void }) => {
  const save = useAction(api.places.saved.save);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (value.trim() === "") return setProblem(SAVE_PROBLEMS.empty());
    setSaving(true);
    setProblem(null);
    save({ label, address: value })
      .then((result) => {
        if (!result.ok) return setProblem(SAVE_PROBLEMS[result.error.kind]());
        onDone?.();
      })
      .catch(() => setProblem("Could not reach LifeOS. Try again in a moment."))
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name={`${label}-address`}
          aria-label={`${title} address`}
          aria-invalid={problem !== null || undefined}
          placeholder="Street, suburb and postcode…"
          autoComplete="street-address"
          spellCheck={false}
          value={value}
          disabled={saving}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && onDone) onDone();
          }}
          className="h-8 min-w-[12rem] flex-1 rounded-lg bg-foreground/[0.05] px-2.5 text-small outline-none select-text placeholder:text-faint-foreground transition-[background-color,box-shadow] duration-(--dur-fast) ease-out focus-visible:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Finding…" : "Save"}
        </Button>
        {onDone && initial !== "" && (
          <Button variant="quiet" disabled={saving} onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {problem && <Problem>{problem}</Problem>}
    </form>
  );
};

const PlaceRow = ({ place, saved }: { place: (typeof PLACES)[number]; saved: SavedPlace | undefined }) => {
  const remove = useAction(api.places.saved.remove);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const confirmRemove = () =>
    askToConfirm({
      title: `Remove your ${place.title.toLowerCase()} address?`,
      body:
        place.label === "home"
          ? "LifeOS forgets it, and Places stops finding trips until you add it again."
          : "LifeOS forgets it. You can add it again any time.",
      action: "Remove",
      onConfirm: () => {
        setProblem(null);
        remove({ label: place.label }).catch(() => setProblem("Could not reach LifeOS to remove it. Try again in a moment."));
      },
    });

  if (saved && !editing)
    return (
      <SettingsRow icon={place.icon} label={place.title} hint={saved.found || saved.address} below={problem ? <Problem>{problem}</Problem> : null}>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Change
        </Button>
        <Button variant="quiet" onClick={confirmRemove}>
          Remove
        </Button>
      </SettingsRow>
    );

  return (
    <SettingsRow
      icon={place.icon}
      label={place.title}
      hint={place.hint}
      below={<AddressForm label={place.label} title={place.title} initial={saved?.address ?? ""} onDone={saved ? () => setEditing(false) : undefined} />}
    />
  );
};

export const PlacesSettings = () => {
  const saved = useQuietView(api.places.saved.list, {});
  const features = useFeatures();
  const mode = features.of("places")?.settings;
  const travelMode = mode && "travelMode" in mode ? mode.travelMode : "drive";
  const ModeIcon = MODES.find((entry) => entry.value === travelMode)?.icon ?? Car;
  return (
    <>
      <SettingsGroup
        title="Your places"
        hint="Your address stays in LifeOS. It goes once to OpenStreetMap to find it on the map, and shops and travel times are looked up from a point about 100 m away."
      >
        {saved === undefined ? (
          <p className="px-3.5 py-3.5 text-small text-muted-foreground">Loading…</p>
        ) : (
          PLACES.map((place) => <PlaceRow key={place.label} place={place} saved={saved.find((entry) => entry.label === place.label)} />)
        )}
      </SettingsGroup>
      <SettingsGroup title="Getting there">
        <SettingsRow icon={ModeIcon} label="Travel Mode" hint="Travel times are worked out this way. Public transport is not available yet.">
          <Segmented
            label="Travel Mode"
            size="sm"
            value={travelMode}
            onValueChange={(next) => void features.setTravelMode(next)}
            options={MODES.map(({ value, label }) => ({ value, label }))}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
};

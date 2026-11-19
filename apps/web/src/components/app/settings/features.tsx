"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { ViewTransition, type MouseEvent, type ReactNode } from "react";
import { FEATURE_IDS, FEATURES, type FeatureId } from "@lifeos/backend/features";
import { Switch } from "@/components/ui/choice-controls";
import { ListPage } from "../list-page";
import { TemplatesList } from "../screens/templates";
import { routeHref, type Route } from "../route";
import { useShell, type Depth } from "../shell-context";
import { FEATURE_ICONS } from "./feature-icons";
import { STATUS_WORDS, statusTone, useFeatures, type FeatureState } from "./feature-state";
import { AiSettings } from "./ai-settings";
import { PlacesSettings } from "./places-settings";
import { SettingsGroup, StatusLamp } from "./rows";

const FEATURE_PAGES = {
  ai: <AiSettings />,
  places: <PlacesSettings />,
  templates: <TemplatesList />,
} satisfies Record<FeatureId, ReactNode>;

const useGo = () => {
  const { navigate } = useShell();
  return (route: Route, depth: Depth) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate(route, "pointer", depth);
  };
};

const FeatureGlyph = ({ feature, large = false }: { feature: FeatureId; large?: boolean }) => {
  const Glyph = FEATURE_ICONS[FEATURES[feature].icon];
  return (
    <span
      className={
        large
          ? "grid size-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand"
          : "grid size-8 shrink-0 place-items-center self-start rounded-lg bg-foreground/[0.06] text-muted-foreground"
      }
    >
      <Glyph weight="fill" className={large ? "size-5" : "size-4"} aria-hidden="true" />
    </span>
  );
};

const FeatureTile = ({ feature, large = false }: { feature: FeatureId; large?: boolean }) => (
  <ViewTransition name={`feature-icon-${feature}`} share="auto" default="none">
    <FeatureGlyph feature={feature} large={large} />
  </ViewTransition>
);

const FeatureLink = ({ state, onSwitch, quiet = false }: { state: FeatureState; onSwitch?: (enabled: boolean) => void; quiet?: boolean }) => {
  const go = useGo();
  const spec = FEATURES[state.feature];
  const route = { kind: "settings", feature: state.feature } satisfies Route;
  return (
    <div className="relative flex items-center gap-3 px-3.5 py-3 transition-[background-color] duration-(--dur-fast) ease-out first:rounded-t-xl last:rounded-b-xl has-[a:hover]:bg-foreground/[0.025] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50">
      {quiet ? <FeatureGlyph feature={state.feature} /> : <FeatureTile feature={state.feature} />}
      <div className="min-w-0 flex-1">
        <a href={routeHref(route)} onClick={go(route, "nav-forward")} className="text-small font-medium outline-none after:absolute after:inset-0">
          {spec.title}
        </a>
        <p className="text-small text-pretty text-muted-foreground">{spec.summary}</p>
      </div>
      <StatusLamp tone={statusTone(state.status)} className="max-sm:hidden">
        {STATUS_WORDS[state.status.kind]()}
      </StatusLamp>
      {onSwitch && (
        <span className="relative z-10 flex">
          <Switch aria-label={spec.title} checked={state.enabled} onCheckedChange={onSwitch} />
        </span>
      )}
      <CaretRight weight="bold" className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
    </div>
  );
};

export const FeaturesSection = () => {
  const features = useFeatures();
  return (
    <SettingsGroup title="Features" hint="Optional parts of LifeOS. Each has its own page for keys and settings.">
      {features.states ? (
        features.states.map((state) => (
          <FeatureLink key={state.feature} state={state} onSwitch={(enabled) => void features.setEnabled(state.feature, enabled)} />
        ))
      ) : (
        <p className="px-3.5 py-3.5 text-small text-muted-foreground">Loading…</p>
      )}
    </SettingsGroup>
  );
};

const statusHint = (state: FeatureState) => {
  if (state.status.kind === "needs_key") return "Switched on, and waiting for an OpenAI or OpenCode Go key below.";
  if (state.status.kind === "needs_feature") return `Switched on, and waiting for ${FEATURES[state.status.feature].title}. Places asks AI which Tasks need a trip.`;
  if (state.status.kind === "needs_setup") return "Switched on, and waiting for your home address below.";
  return FEATURES[state.feature].summary;
};

const BackToSettings = () => {
  const go = useGo();
  const route = { kind: "settings" } satisfies Route;
  return (
    <a
      href={routeHref(route)}
      onClick={go(route, "nav-back")}
      className="-ml-1.5 mb-1 inline-flex h-7 items-center gap-1 rounded-full px-1.5 text-small text-muted-foreground transition-[color,background-color,scale] duration-(--dur-fast) ease-out outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
    >
      <CaretLeft weight="bold" className="size-3.5" aria-hidden="true" />
      Settings
    </a>
  );
};

const WorksWith = ({ feature }: { feature: FeatureId }) => {
  const features = useFeatures();
  const partners = FEATURE_IDS.filter(
    (other) => other !== feature && ((FEATURES[feature].uses as readonly string[]).includes(other) || (FEATURES[other].uses as readonly string[]).includes(feature)),
  );
  const states = partners.flatMap((other) => {
    const state = features.of(other);
    return state ? [state] : [];
  });
  if (states.length === 0) return null;
  return (
    <SettingsGroup title="Works with" hint={WORKS_WITH_HINT[feature]}>
      {states.map((state) => (
        <FeatureLink key={state.feature} state={state} quiet />
      ))}
    </SettingsGroup>
  );
};

const WORKS_WITH_HINT = {
  ai: "When Places finds a trip for a Task, the Smart Estimate adds the time there and back.",
  places: "AI spots which Tasks need a trip, and Smart Estimates adds the time there and back.",
  templates: "",
} satisfies Record<FeatureId, string>;

export const FeatureScreen = ({ feature }: { feature: FeatureId }) => {
  const features = useFeatures();
  const spec = FEATURES[feature];
  const state = features.of(feature);
  return (
    <ListPage
      title={spec.title}
      leading={<FeatureTile feature={feature} large />}
      heading={
        <>
          <BackToSettings />
          <h1 className="text-title font-semibold text-balance">{spec.title}</h1>
        </>
      }
      subtitle={state ? <span className="text-pretty">{statusHint(state)}</span> : null}
      aside={
        state && (
          <span className="flex shrink-0 items-center gap-3 self-end">
            <StatusLamp tone={statusTone(state.status)}>{STATUS_WORDS[state.status.kind]()}</StatusLamp>
            <Switch aria-label={spec.title} checked={state.enabled} onCheckedChange={(enabled) => void features.setEnabled(feature, enabled)} />
          </span>
        )
      }
    >
      {FEATURE_PAGES[feature]}
      <WorksWith feature={feature} />
    </ListPage>
  );
};

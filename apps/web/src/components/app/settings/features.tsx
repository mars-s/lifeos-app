"use client";

import { CaretLeft, CaretRight, Key } from "@phosphor-icons/react";
import { useAction } from "convex/react";
import { useState, ViewTransition, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { FEATURE_IDS, FEATURES, type FeatureId } from "@lifeos/backend/features";
import type { SecretError } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { Switch } from "@/components/ui/choice-controls";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";
import { ListPage } from "../list-page";
import { routeHref, type Route } from "../route";
import { useShell, type Depth } from "../shell-context";
import { FEATURE_ICONS } from "./feature-icons";
import { STATUS_WORDS, statusTone, useFeatures, type FeatureState } from "./feature-state";
import { PlacesSettings } from "./places-settings";
import { Problem, SettingsGroup, SettingsRow, StatusLamp } from "./rows";

const SECRET_PROBLEMS = {
  empty: () => "Paste a key first.",
  not_set_up: () => "Secrets are not set up on this LifeOS, so the key cannot be saved yet.",
  refused: () => "OpenAI refused this key. Check it and paste it again.",
  unreachable: () => "Could not reach OpenAI. Try again in a moment.",
  unavailable: ({ status }: { status: number }) => `OpenAI did not answer (error ${status}). Try again in a moment.`,
} satisfies { [K in SecretError["kind"]]: (error: Extract<SecretError, { kind: K }>) => string };

const problemOf = (error: SecretError) =>
  error.kind === "unavailable" ? SECRET_PROBLEMS.unavailable(error) : SECRET_PROBLEMS[error.kind]();

const KeyForm = ({ onSaved, onCancel }: { onSaved: () => void; onCancel?: () => void }) => {
  const save = useAction(api.platform.secrets.save);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (value.trim() === "") return setProblem(SECRET_PROBLEMS.empty());
    setSaving(true);
    setProblem(null);
    save({ name: "openai", value })
      .then((result) => {
        if (!result.ok) return setProblem(problemOf(result.error));
        setValue("");
        onSaved();
      })
      .catch(() => setProblem("Could not reach LifeOS. Try again in a moment."))
      .finally(() => setSaving(false));
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-lg bg-foreground/[0.05] px-2.5 transition-[background-color,box-shadow] duration-(--dur-fast) ease-out focus-within:bg-foreground/[0.08] has-focus-visible:ring-2 has-focus-visible:ring-ring/50">
          <Key weight="fill" className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
          <input
            type="password"
            name="openai-key"
            aria-label="OpenAI API key"
            aria-invalid={problem !== null || undefined}
            placeholder="sk-…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            value={value}
            disabled={saving}
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && onCancel) onCancel();
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-small outline-none select-text placeholder:font-sans placeholder:text-faint-foreground disabled:opacity-60"
          />
        </label>
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Checking…" : "Save"}
        </Button>
        {onCancel && (
          <Button variant="quiet" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {problem && <Problem>{problem}</Problem>}
    </form>
  );
};

const OpenAiKey = () => {
  const saved = useQuietView(api.platform.secrets.status, { name: "openai" });
  const configured = useQuietView(api.platform.secrets.available, { name: "openai" }) ?? false;
  const remove = useAction(api.platform.secrets.remove);
  const [replacing, setReplacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (saved === undefined) return null;

  if (saved && !replacing) {
    const confirmRemove = () =>
      askToConfirm({
        title: "Remove the OpenAI key?",
        body: "LifeOS forgets the saved key. Smart Estimates and Places go back to a key set in Core, if there is one.",
        action: "Remove",
        onConfirm: () => {
          setProblem(null);
          remove({ name: "openai" }).catch(() => setProblem("Could not reach LifeOS to remove the key. Try again in a moment."));
        },
      });
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="mr-auto flex items-center gap-2 text-small text-muted-foreground">
            <Key weight="fill" className="size-3.5 shrink-0 text-faint-foreground" aria-hidden="true" />
            <span>
              Key saved, ends in{" "}
              <span translate="no" className="font-mono text-foreground">{saved.last4}</span>
            </span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Button variant="quiet" onClick={confirmRemove}>
              Remove
            </Button>
          </div>
        </div>
        {problem && <Problem>{problem}</Problem>}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <KeyForm onSaved={() => setReplacing(false)} onCancel={saved ? () => setReplacing(false) : undefined} />
      {!saved && configured && (
        <p className="text-small text-pretty text-faint-foreground">Using the key set in Core for now. A key saved here takes its place.</p>
      )}
    </div>
  );
};

const FEATURE_PAGES = {
  smartEstimates: null,
  places: <PlacesSettings />,
} satisfies Record<FeatureId, ReactNode>;

const KEY_HINTS = {
  openai: "LifeOS checks a key with OpenAI before it keeps it. It is sealed, and never shown again.",
} as const;

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
  if (state.status.kind === "needs_key") return "Switched on, and waiting for an OpenAI key below.";
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
  smartEstimates: "When Places finds a trip for a Task, the Smart Estimate adds the time there and back.",
  places: "Smart Estimates adds the trip there and back to its guess for an errand.",
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
      {spec.secrets.map((secret) => (
        <SettingsGroup key={secret} title="OpenAI key" hint={KEY_HINTS[secret]}>
          <SettingsRow icon={Key} label="OpenAI" hint="One key, shared by every Feature that asks OpenAI." below={<OpenAiKey />} />
        </SettingsGroup>
      ))}
      <WorksWith feature={feature} />
    </ListPage>
  );
};

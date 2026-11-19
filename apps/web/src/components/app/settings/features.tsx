"use client";

import { Hourglass, Key } from "@phosphor-icons/react";
import { useAction } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@lifeos/backend/api";
import type { SecretError } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";
import { useSmartEstimates } from "../smart-estimate";
import { FeatureRow, Problem, SettingsGroup } from "./rows";

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

const OpenAiKey = ({ configured }: { configured: boolean }) => {
  const saved = useQuietView(api.platform.secrets.status, { name: "openai" });
  const remove = useAction(api.platform.secrets.remove);
  const [replacing, setReplacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (saved === undefined) return null;

  if (saved && !replacing) {
    const confirmRemove = () =>
      askToConfirm({
        title: "Remove the OpenAI key?",
        body: "LifeOS forgets the saved key. Smart Estimates goes back to a key set in Core, if there is one.",
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

const SmartEstimatesRow = () => {
  const smart = useSmartEstimates();
  if (!smart.status) return <p className="px-3.5 py-3.5 text-small text-muted-foreground">Loading…</p>;
  return (
    <FeatureRow
      icon={Hourglass}
      label="Smart Estimates"
      hint={
        smart.status.configured
          ? "Suggests an Estimate when you open a Task that has none. You choose whether to keep it."
          : "Needs an OpenAI key before it can suggest Estimates. Paste one below; LifeOS checks it with OpenAI first."
      }
      checked={smart.status.enabled && smart.status.configured}
      onCheckedChange={(enabled) => void smart.set(enabled)}
      disabled={!smart.status.configured}
      below={<OpenAiKey configured={smart.status.configured} />}
    />
  );
};

export const FeaturesSection = () => (
  <SettingsGroup title="Features" hint="Switch optional parts of LifeOS on or off.">
    <SmartEstimatesRow />
  </SettingsGroup>
);

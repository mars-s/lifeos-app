"use client";

import { Key } from "@phosphor-icons/react";
import { useAction } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@lifeos/backend/api";
import { PROVIDERS, type ProviderId } from "@lifeos/backend/ai";
import type { SecretError } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { askToConfirm } from "../confirm";
import { useQuietView } from "../hooks";
import { Problem } from "./rows";

const KEY_PLACEHOLDERS = { openai: "sk-…", opencodeGo: "Your OpenCode Go key" } as const satisfies Record<ProviderId, string>;

const SECRET_PROBLEMS = {
  empty: () => "Paste a key first.",
  not_set_up: () => "Secrets are not set up on this LifeOS, so the key cannot be saved yet.",
  refused: (provider: string) => `${provider} refused this key. Check it and paste it again.`,
  unreachable: (provider: string) => `Could not reach ${provider}. Try again in a moment.`,
  unavailable: (provider: string, status: number) => `${provider} did not answer (error ${status}). Try again in a moment.`,
} as const;

const problemOf = (error: SecretError, provider: string) =>
  error.kind === "unavailable" ? SECRET_PROBLEMS.unavailable(provider, error.status) : SECRET_PROBLEMS[error.kind](provider);

const KeyForm = ({ provider, onSaved, onCancel }: { provider: ProviderId; onSaved: () => void; onCancel?: () => void }) => {
  const { title, secret } = PROVIDERS[provider];
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
    save({ name: secret, value })
      .then((result) => {
        if (!result.ok) return setProblem(problemOf(result.error, title));
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
            name={`${secret}-key`}
            aria-label={`${title} API key`}
            aria-invalid={problem !== null || undefined}
            placeholder={KEY_PLACEHOLDERS[provider]}
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

export const ProviderKey = ({ provider }: { provider: ProviderId }) => {
  const { title, secret } = PROVIDERS[provider];
  const saved = useQuietView(api.platform.secrets.status, { name: secret });
  const configured = useQuietView(api.platform.secrets.available, { name: secret }) ?? false;
  const remove = useAction(api.platform.secrets.remove);
  const [replacing, setReplacing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (saved === undefined) return null;

  if (saved && !replacing) {
    const confirmRemove = () =>
      askToConfirm({
        title: `Remove the ${title} key?`,
        body: "LifeOS forgets the saved key. AI goes back to a key set in Core, if there is one, or to your other key.",
        action: "Remove",
        onConfirm: () => {
          setProblem(null);
          remove({ name: secret }).catch(() => setProblem("Could not reach LifeOS to remove the key. Try again in a moment."));
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
      <KeyForm provider={provider} onSaved={() => setReplacing(false)} onCancel={saved ? () => setReplacing(false) : undefined} />
      {!saved && configured && (
        <p className="text-small text-pretty text-faint-foreground">Using the key set in Core for now. A key saved here takes its place.</p>
      )}
    </div>
  );
};


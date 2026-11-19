"use client";

import { ArrowCounterClockwise, Eye, PencilSimple, Plugs } from "@phosphor-icons/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import { Button } from "@/components/ui/action-button";
import { Checkbox } from "@/components/ui/choice-controls";
import { LifeosMark } from "@/components/lifeos/mark";
import { OwnerGate } from "@/components/owner-gate";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => undefined;

const useFramed = () =>
  useSyncExternalStore(
    noSubscribe,
    () => window.top !== window.self,
    () => false,
  );

const useRequestId = () =>
  useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("request"),
    () => null,
  );

const scopeIcons: Record<string, typeof Eye> = { "lifeos:read": Eye, "lifeos:write": PencilSimple };

const problemOf = (error: unknown) =>
  error instanceof ConvexError && typeof error.data === "string" ? error.data : "LifeOS could not save that. Try again.";

const hostOf = (uri: string | undefined) => {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
};

const Page = ({ title, hint, children }: { title: string; hint: ReactNode; children?: ReactNode }) => (
  <main className="mx-auto flex min-h-dvh w-full max-w-[25rem] flex-col justify-center gap-6 px-6 py-12">
    <header className="flex flex-col items-center gap-4 text-center">
      <LifeosMark fill="enter" className="size-10" />
      <div className="space-y-1.5">
        <h1 className="text-title font-semibold text-balance">{title}</h1>
        <p className="text-small text-pretty text-muted-foreground">{hint}</p>
      </div>
    </header>
    {children}
  </main>
);

const Problem = ({ text }: { text: string | null }) => (
  <p role="status" aria-live="polite" className={cn("min-h-5 text-center text-small", text ? "text-negative" : "text-muted-foreground")}>
    {text}
  </p>
);

const FindByCode = () => {
  const find = useMutation(api.mcp.findAuthRequest);
  const [code, setCode] = useState("");
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFinding(true);
    setProblem(null);
    find({ userCode: code })
      .then((requestId) => {
        if (requestId) return window.location.assign(`?request=${encodeURIComponent(requestId)}`);
        setProblem("No agent is waiting with that code. Check it and try again.");
        haptic("error");
      })
      .catch((error: unknown) => setProblem(problemOf(error)))
      .finally(() => setFinding(false));
  };
  return (
    <Page title="Connect an agent" hint="Type the code your agent is showing.">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          name="user-code"
          aria-label="Code from your agent"
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setProblem(null);
          }}
          className="h-9 min-w-0 flex-1 rounded-lg bg-foreground/[0.05] px-3 font-mono text-body tracking-wider uppercase outline-none select-text placeholder:text-faint-foreground placeholder:normal-case transition-[background-color,box-shadow] duration-(--dur-fast) ease-out focus-visible:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" variant="primary" size="md" loading={finding} disabled={code.trim().length === 0}>
          Find
        </Button>
      </form>
      <Problem text={problem} />
    </Page>
  );
};

type Decided = { approved: boolean; device: boolean; host: string | null };

const Consent = ({ requestId }: { requestId: string }) => {
  useQuery(api.platform.access.account, {});
  const request = useQuery(api.mcp.getAuthRequest, { requestId });
  const authorize = useAction(api.mcp.authorize);
  const [codeMatches, setCodeMatches] = useState(false);
  const [deciding, setDeciding] = useState<"allow" | "deny" | null>(null);
  const [decided, setDecided] = useState<Decided | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (request === undefined) {
    return (
      <div aria-busy="true" className="grid min-h-dvh place-items-center">
        <LifeosMark fill="loop" className="size-10 animate-delayed-in" />
      </div>
    );
  }
  if (request === null) {
    return <Page title="This link has expired" hint="Connection requests last a few minutes. Start again from your agent." />;
  }

  const device = request.kind === "device";
  const name = request.clientName?.trim() ?? "";
  const unnamed = name === "" || /^an? agent$/i.test(name);
  const agent = unnamed ? "your agent" : name;
  const host = hostOf(request.redirectUri);
  if (decided) {
    if (!decided.approved) return <Page title="Not connected" hint={`${unnamed ? "The agent" : name} cannot use your LifeOS. You can close this tab.`} />;
    return decided.device ? (
      <Page title="Connected" hint={`Go back to ${agent}. It can use your LifeOS now.`} />
    ) : (
      <Page title="Connected" hint={`Taking you back to ${decided.host ?? agent}…`} />
    );
  }
  if (request.status !== "pending") {
    return <Page title="Already answered" hint="This request was approved or denied already. Start again from your agent if you need to." />;
  }

  const decide = (approve: boolean) => {
    setDeciding(approve ? "allow" : "deny");
    setProblem(null);
    authorize({ requestId, approve, ...(device && approve && request.userCode ? { userCode: request.userCode } : {}) })
      .then(({ redirectUrl }) => {
        haptic(approve ? "complete" : "toggle");
        setDecided({ approved: approve, device: redirectUrl === null, host });
        if (redirectUrl) window.location.assign(redirectUrl);
      })
      .catch((error: unknown) => {
        setProblem(problemOf(error));
        haptic("error");
      })
      .finally(() => setDeciding(null));
  };

  return (
    <Page
      title={unnamed ? "Connect an agent to LifeOS" : `Connect ${name} to LifeOS`}
      hint={
        unnamed
          ? "This agent gave no name. Only allow it if you just asked it to connect."
          : `The agent calls itself ${name}. LifeOS cannot check that name, so only allow it if you just asked it to connect.`
      }
    >
      <section aria-label="What it can do" className="rounded-xl bg-surface-inset shadow-(--shadow-well)">
        <ul className="divide-y divide-border">
          {request.scopes.map((scope) => {
            const Icon = scopeIcons[scope.name] ?? Plugs;
            return (
              <li key={scope.name} className="flex items-start gap-3 px-4 py-3">
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="text-small">{scope.description}</span>
              </li>
            );
          })}
          <li className="flex items-start gap-3 px-4 py-3">
            <ArrowCounterClockwise aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="text-small text-muted-foreground">Each change it makes is recorded as an Agent Run you can undo</span>
          </li>
        </ul>
      </section>

      {device && request.userCode ? (
        <section aria-label="Check the code" className="flex flex-col items-center gap-3">
          <p translate="no" className="font-mono text-heading tracking-[0.2em] tabular-nums select-all">
            {request.userCode}
          </p>
          <Checkbox
            checked={codeMatches}
            onCheckedChange={setCodeMatches}
            label={`This matches the code ${agent} shows`}
          />
        </section>
      ) : host ? (
        <p className="text-center text-small text-muted-foreground">
          After you choose, you go back to <span className="font-medium text-foreground">{host}</span>
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="md" loading={deciding === "deny"} disabled={deciding !== null} onClick={() => decide(false)}>
          Deny
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={deciding === "allow"}
          disabled={deciding !== null || (device && !codeMatches)}
          onClick={() => decide(true)}
        >
          Allow
        </Button>
      </div>
      <Problem text={problem} />
    </Page>
  );
};

export const ConnectPage = () => {
  const framed = useFramed();
  const requestId = useRequestId();
  if (framed) {
    return <Page title="Open this page on its own" hint="LifeOS will not ask for approval inside another site. Open the link in a new tab." />;
  }
  return <OwnerGate>{requestId ? <Consent requestId={requestId} /> : <FindByCode />}</OwnerGate>;
};

"use client";

import { Moon, type Icon } from "@phosphor-icons/react";
import { Dialog } from "radix-ui";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { LifeosMark } from "@/components/lifeos/mark";
import { Button } from "@/components/ui/action-button";
import { KeyCombo } from "@/components/ui/key-hint";
import { PERMISSIONS, useMac, type Mac, type Permission } from "@/lib/mac";
import { cn } from "@/lib/utils";
import { useOura } from "../oura";
import { useShell } from "../shell-context";
import { askFor, useMacState, type MacState } from "./mac-state";
import { PERMISSION_COPY, actionLabel, statusHint, statusTone, statusWord } from "./permission-copy";
import { StatusLamp, type LampTone } from "./rows";

type Step = { kind: "permission"; permission: Permission } | { kind: "oura" } | { kind: "ready" };

const STEPS: readonly Step[] = [...PERMISSIONS.map((permission) => ({ kind: "permission", permission }) as const), { kind: "oura" }, { kind: "ready" }];
const ASKING_STEPS = STEPS.length - 1;

type Outcome = { tone: LampTone; word: string };
type Advance = (event: MouseEvent) => void;

const StepDots = ({ at, outcomes }: { at: number; outcomes: readonly Outcome[] }) => (
  <ol aria-label="Setup steps" className="flex items-center gap-2">
    {outcomes.map((outcome, index) => (
      <li
        key={index}
        aria-current={index === at ? "step" : undefined}
        className={cn(
          "size-2 rounded-full transition-[background-color,box-shadow] duration-(--dur-base) ease-out",
          index > at || (index === at && outcome.tone !== "positive")
            ? index === at
              ? "bg-foreground/45"
              : "bg-foreground/[0.14]"
            : outcome.tone === "positive"
              ? "bg-brand"
              : "shadow-[inset_0_0_0_1.5px_var(--faint-foreground)]",
        )}
      >
        <span className="sr-only">{`Step ${index + 1}: ${outcome.word}`}</span>
      </li>
    ))}
  </ol>
);

const StepBody = ({
  icon: IconComponent,
  count,
  title,
  why,
  outcome,
  children,
}: {
  icon: Icon;
  count: string;
  title: string;
  why: string;
  outcome: Outcome;
  children: ReactNode;
}) => (
  <>
    <span className="grid size-12 place-items-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
      <IconComponent weight="fill" className="size-6" aria-hidden="true" />
    </span>
    <p className="mt-5 font-mono text-micro text-faint-foreground tabular-nums">{count}</p>
    <Dialog.Title className="mt-1 text-title font-semibold text-balance">{title}</Dialog.Title>
    <Dialog.Description className="mt-2 min-h-12 text-body text-pretty text-muted-foreground">{why}</Dialog.Description>
    <StatusLamp tone={outcome.tone} className="mt-5 h-6">
      {outcome.word}
    </StatusLamp>
    <div className="mt-6 flex min-h-9 flex-wrap items-center gap-2">{children}</div>
  </>
);

const PermissionStep = ({
  mac,
  state,
  permission,
  count,
  next,
}: {
  mac: Mac;
  state: MacState;
  permission: Permission;
  count: string;
  next: Advance;
}) => {
  const copy = PERMISSION_COPY[permission];
  const status = state.permissions[permission];
  const action = actionLabel(permission, status);
  const asking = state.asking === permission;
  const ask = () => void askFor(mac, permission);
  return (
    <StepBody
      icon={copy.icon}
      count={count}
      title={copy.label}
      why={statusHint(permission, status)}
      outcome={{ tone: statusTone(status), word: asking ? "Waiting for macOS…" : statusWord(permission, status) }}
    >
      {status === "notAsked" ? (
        <>
          <Button autoFocus variant="primary" size="md" loading={asking} onClick={ask}>
            Allow
          </Button>
          <Button variant="quiet" size="md" disabled={asking} onClick={next}>
            Skip
          </Button>
        </>
      ) : (
        <>
          <Button autoFocus variant="primary" size="md" onClick={next}>
            Continue
          </Button>
          {action && (
            <Button variant="secondary" size="md" loading={asking} onClick={ask}>
              {action}
            </Button>
          )}
        </>
      )}
    </StepBody>
  );
};

const ouraOutcome = (setup: "connected" | "not_connected" | "not_configured" | undefined) =>
  (setup === "connected"
    ? { tone: "positive", word: "Connected" }
    : setup === "not_configured"
      ? { tone: "quiet", word: "Not set up on this LifeOS" }
      : { tone: "quiet", word: "Not connected" }) satisfies Outcome;

const OuraStep = ({ count, next }: { count: string; next: Advance }) => {
  const { today } = useShell();
  const { status, problem, startConnect } = useOura(today);
  const connectable = status?.setup === "not_connected";
  return (
    <StepBody
      icon={Moon}
      count={count}
      title="Oura"
      why={problem ?? "Optional. Your sleep shows on the Timebox, with Oura's bedtime and your usual wake."}
      outcome={ouraOutcome(status?.setup)}
    >
      {connectable ? (
        <>
          <Button autoFocus variant="primary" size="md" onClick={startConnect}>
            Connect Oura
          </Button>
          <Button variant="quiet" size="md" onClick={next}>
            Not now
          </Button>
        </>
      ) : (
        <Button autoFocus variant="primary" size="md" onClick={next}>
          Continue
        </Button>
      )}
    </StepBody>
  );
};

const ReadyStep = ({ outcomes, finish }: { outcomes: readonly Outcome[]; finish: () => void }) => (
  <>
    <LifeosMark fill="enter" className="size-12" />
    <Dialog.Title className="mt-6 text-title font-semibold text-balance">This Mac is ready</Dialog.Title>
    <Dialog.Description className="mt-2 text-body text-pretty text-muted-foreground">
      LifeOS will not ask again. Change any of these in Settings
      <KeyCombo keys="mod+," className="ml-1.5 inline-flex align-middle" />
    </Dialog.Description>
    <ul className="mt-5 rounded-xl bg-foreground/[0.035] px-3.5 py-1.5">
      {[...PERMISSIONS.map((permission) => PERMISSION_COPY[permission].label), "Oura"].map((label, index) => (
        <li key={label} className="flex h-9 items-center justify-between gap-4 text-small">
          <span className="font-medium">{label}</span>
          <StatusLamp tone={outcomes[index]?.tone ?? "quiet"}>{outcomes[index]?.word ?? ""}</StatusLamp>
        </li>
      ))}
    </ul>
    <div className="mt-6 flex min-h-9">
      <Button autoFocus variant="primary" size="md" onClick={finish}>
        Open LifeOS
      </Button>
    </div>
  </>
);

const Flow = ({ mac, state, finish }: { mac: Mac; state: MacState; finish: () => void }) => {
  const { today } = useShell();
  const oura = useOura(today).status?.setup;
  const [at, setAt] = useState(0);
  const [glide, setGlide] = useState(false);
  const step = STEPS[at] ?? { kind: "ready" };
  const outcomes = [
    ...PERMISSIONS.map((permission) => ({ tone: statusTone(state.permissions[permission]), word: statusWord(permission, state.permissions[permission]) })),
    ouraOutcome(oura),
  ];
  const next: Advance = (event) => {
    setGlide(event.detail !== 0);
    setAt((current) => Math.min(current + 1, STEPS.length - 1));
  };
  const count = `${at + 1} of ${ASKING_STEPS}`;
  return (
    <div className="w-full max-w-[26rem] px-6 pb-10">
      {step.kind !== "ready" && (
        <header className="mb-10 flex items-center justify-between">
          <span className="flex items-center gap-2 text-small font-medium">
            <LifeosMark />
            Setting up this Mac
          </span>
          <StepDots at={at} outcomes={outcomes} />
        </header>
      )}
      <div key={at} className={cn(glide && "animate-screen-in motion-reduce:animate-none")}>
        {step.kind === "permission" ? (
          <PermissionStep mac={mac} state={state} permission={step.permission} count={count} next={next} />
        ) : step.kind === "oura" ? (
          <OuraStep count={count} next={next} />
        ) : (
          <ReadyStep outcomes={outcomes} finish={finish} />
        )}
      </div>
    </div>
  );
};

type Phase = "unknown" | "needed" | "done";

export const Onboarding = () => {
  const mac = useMac();
  const state = useMacState(mac);
  const [phase, setPhase] = useState<Phase>("unknown");
  useEffect(() => {
    if (!mac) return;
    let live = true;
    mac.onboarded().then(
      (done) => live && setPhase(done ? "done" : "needed"),
      () => live && setPhase("done"),
    );
    return () => {
      live = false;
    };
  }, [mac]);
  if (!mac || phase === "done") return null;
  const finish = () => {
    void mac.finishOnboarding();
    setPhase("done");
  };
  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
          }}
          className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-surface outline-none select-none"
        >
          <div data-tauri-drag-region aria-hidden="true" className="fixed inset-x-0 top-0 h-7" />
          {phase === "needed" && state ? (
            <Flow mac={mac} state={state} finish={finish} />
          ) : (
            <>
              <Dialog.Title className="sr-only">Setting up this Mac</Dialog.Title>
              <Dialog.Description className="sr-only">Checking what macOS already allows.</Dialog.Description>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

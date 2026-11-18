"use client";

import { Moon } from "@phosphor-icons/react";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { SleepStatus } from "@lifeos/backend/types";
import { Button } from "@/components/ui/action-button";
import { Popover } from "@/components/ui/popover-panel";
import { formatClock, formatRange } from "@/components/lifeos/format";
import { timeAgo } from "./dates";
import { useNow, useQuietView } from "./hooks";

const SYNC_PATIENCE_MS = 30_000;

type Plan = NonNullable<SleepStatus["plan"]>;

const onClock = (minute: number) => ((minute % 1440) + 1440) % 1440;
const clockOf = (minute: number) => formatClock(onClock(minute));

const syncLine = (status: SleepStatus, now: number | null) => {
  const sync = status.sync;
  if (!sync || sync.kind === "never") return "Pulling your sleep from Oura…";
  const ago = (at: number) => (now === null ? "" : ` ${timeAgo(at, Math.max(now, at))}`);
  if (sync.kind === "ok") return `Read from Oura${ago(sync.at)}. LifeOS checks again every four hours.`;
  if (sync.error.kind === "unauthorised" || sync.error.kind === "forbidden")
    return "Oura stopped sharing your sleep. Connect again to pick it back up.";
  return `Oura did not answer${ago(sync.at)}. LifeOS tries again every four hours.`;
};

const PlanRows = ({ plan }: { plan: Plan }) => (
  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-2.5 pb-2 text-small whitespace-nowrap">
    <dt className="text-muted-foreground">{plan.bedtime.source === "oura" ? "Oura's bedtime" : "Your usual bedtime"}</dt>
    <dd className="text-right font-mono text-foreground tabular-nums">
      {plan.bedtime.source === "oura"
        ? formatRange(onClock(plan.bedtime.startMinute), onClock(plan.bedtime.endMinute))
        : clockOf(plan.bedtime.startMinute)}
    </dd>
    <dt className="text-muted-foreground">Your usual wake</dt>
    <dd className="text-right font-mono text-foreground tabular-nums">{clockOf(plan.wakeMinute)}</dd>
  </dl>
);

const waitingLine = (status: SleepStatus) =>
  status.ouraStatus === "not_enough_nights" || status.ouraStatus === "not_enough_recent_nights"
    ? "Oura needs a few more nights before it suggests a bedtime. Wear the ring to bed and the Timebox fills in."
    : `LifeOS needs 3 nights of sleep to work out your usual wake. It has ${status.nightsCounted}.`;

export const SleepButton = ({ today }: { today: IsoDate }) => {
  const status = useQuietView(api.health.sleep.status, { today });
  const connect = useMutation(api.health.oura.connect);
  const syncNow = useMutation(api.health.oura.syncNow);
  const now = useNow();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lastSyncAt = status?.sync && status.sync.kind !== "never" ? status.sync.at : 0;
  const syncing = askedAt !== null && lastSyncAt < askedAt && (now ?? askedAt) - askedAt < SYNC_PATIENCE_MS;

  const startConnect = () => {
    setProblem(null);
    const tab = window.open("", "_blank");
    void connect({}).then((result) => {
      if (!result.ok) {
        tab?.close();
        setProblem(result.error.kind === "not_configured" ? "Oura is not set up on this LifeOS yet." : "Could not reach LifeOS to start. Try again in a moment.");
        return;
      }
      if (tab) tab.location.href = result.value.url;
      else window.location.assign(result.value.url);
    });
  };

  const startSync = () => {
    setAskedAt(Date.now());
    void syncNow({});
  };

  const needsConnect =
    status?.setup === "not_connected" ||
    (status?.sync?.kind === "failed" && (status.sync.error.kind === "unauthorised" || status.sync.error.kind === "forbidden"));

  return (
    <Popover
      side="bottom"
      align="end"
      title="Sleep"
      className="w-[18.5rem] p-1.5"
      trigger={
        <button
          type="button"
          aria-label="Sleep"
          title="Sleep from Oura"
          className="grid size-7 shrink-0 place-items-center rounded-full text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-sleep-ink active:scale-[0.94] aria-expanded:bg-foreground/[0.06] aria-expanded:text-sleep-ink"
        >
          <Moon weight="fill" className="size-4" aria-hidden="true" />
        </button>
      }
    >
      {!status ? null : status.setup === "not_configured" ? (
        <p className="px-2.5 pb-2 text-small text-pretty text-muted-foreground">
          Oura is not set up on this LifeOS yet. Once its app is registered, your sleep shows on the Timebox.
        </p>
      ) : status.setup === "not_connected" ? (
        <p className="px-2.5 pb-2 text-small text-pretty text-muted-foreground">
          Connect your Oura ring to see your sleep on the Timebox, with Oura's bedtime and your usual wake.
        </p>
      ) : (
        <>
          <p className="px-2.5 pb-2 text-small text-pretty text-muted-foreground" aria-live="polite">
            {syncing ? "Reading your sleep from Oura…" : syncLine(status, now)}
          </p>
          {status.plan ? <PlanRows plan={status.plan} /> : <p className="px-2.5 pb-2 text-small text-pretty text-muted-foreground">{waitingLine(status)}</p>}
        </>
      )}
      {problem && (
        <p role="alert" className="px-2.5 pb-2 text-small text-negative">
          {problem}
        </p>
      )}
      {status && status.setup !== "not_configured" && (
        <div className="flex justify-end gap-2 px-1.5 pt-0.5 pb-1">
          {status.setup === "connected" && !needsConnect && (
            <Button size="sm" variant="secondary" loading={syncing} onClick={startSync}>
              Sync now
            </Button>
          )}
          {needsConnect && (
            <Button size="sm" variant="primary" onClick={startConnect}>
              {status.setup === "connected" ? "Connect again" : "Connect Oura"}
            </Button>
          )}
        </div>
      )}
    </Popover>
  );
};

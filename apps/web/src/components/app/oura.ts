"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { SleepStatus } from "@lifeos/backend/types";
import { timeAgo } from "./dates";
import { useNow, useQuietView } from "./hooks";

const SYNC_PATIENCE_MS = 30_000;

const refusedBy = (sync: SleepStatus["sync"] | undefined) =>
  sync?.kind === "failed" && (sync.error.kind === "unauthorised" || sync.error.kind === "forbidden");

const syncLine = (status: SleepStatus, now: number | null) => {
  const sync = status.sync;
  if (!sync || sync.kind === "never") return "Pulling your sleep from Oura…";
  const ago = (at: number) => (now === null ? "" : ` ${timeAgo(at, Math.max(now, at))}`);
  if (sync.kind === "ok") return `Read from Oura${ago(sync.at)}. LifeOS checks again every four hours.`;
  if (refusedBy(sync)) return "Oura stopped sharing your sleep. Connect again to pick it back up.";
  return `Oura did not answer${ago(sync.at)}. LifeOS tries again every four hours.`;
};

export const ouraNeedsConnect = (status: SleepStatus | undefined) => status?.setup === "not_connected" || refusedBy(status?.sync);

export const ouraStoppedSharing = (status: SleepStatus | undefined) => status?.setup === "connected" && refusedBy(status.sync);

export const useOura = (today: IsoDate) => {
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

  return {
    status,
    syncing,
    problem,
    needsConnect: ouraNeedsConnect(status),
    line: status?.setup === "connected" ? (syncing ? "Reading your sleep from Oura…" : syncLine(status, now)) : null,
    startConnect,
    startSync,
  };
};

"use client";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useMutation } from "convex/react";
import { Cause, Exit, Option } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { useState } from "react";
import { api } from "@lifeos/backend/api";
import { Backend } from "@lifeos/backend/client/backend";
import type { IsoDate } from "@lifeos/backend/date";
import type { SleepStatus } from "@lifeos/backend/types";
import { timeAgo } from "./dates";
import { atomRuntime } from "../../lib/runtime";
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

const connectAtom = atomRuntime.fn<void>()(() => Backend.use((backend) => backend.change(api.health.oura.connect, {})));

const problemOf = (state: Atom.Type<typeof connectAtom>) => {
  if (state.waiting || !AsyncResult.isFailure(state)) return null;
  const refusal = Option.getOrUndefined(Cause.findErrorOption(state.cause));
  return refusal?.kind === "not_configured" ? "Oura is not set up on this LifeOS yet." : "Could not reach LifeOS to start. Try again in a moment.";
};

export const ouraNeedsConnect = (status: SleepStatus | undefined) => status?.setup === "not_connected" || refusedBy(status?.sync);

export const ouraStoppedSharing = (status: SleepStatus | undefined) => status?.setup === "connected" && refusedBy(status.sync);

export const useOura = (today: IsoDate) => {
  const status = useQuietView(api.health.sleep.status, { today });
  const syncNow = useMutation(api.health.oura.syncNow);
  const now = useNow();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const problem = problemOf(useAtomValue(connectAtom));
  const connect = useAtomSet(connectAtom, { mode: "promiseExit" });
  const lastSyncAt = status?.sync && status.sync.kind !== "never" ? status.sync.at : 0;
  const syncing = askedAt !== null && lastSyncAt < askedAt && (now ?? askedAt) - askedAt < SYNC_PATIENCE_MS;

  const startConnect = () => {
    const tab = window.open("", "_blank");
    void connect().then((exit) => {
      if (Exit.isFailure(exit)) return tab?.close();
      if (tab) tab.location.href = exit.value.url;
      else window.location.assign(exit.value.url);
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

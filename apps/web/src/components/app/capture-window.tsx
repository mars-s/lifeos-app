"use client";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useConvexAuth } from "convex/react";
import { Effect, Exit } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import { Backend } from "@lifeos/backend/client/backend";
import type { IsoDate } from "@lifeos/backend/date";
import { QuickCapturePanel } from "@/components/lifeos/quick-capture";
import { captureArgs, type ResolvedCapture } from "@lifeos/backend/client/capture-model";
import { atomRuntime } from "../../lib/runtime";
import { useCapture } from "./command-bar/use-capture";
import { useLocalDate, useQuietView, valueOf } from "./hooks";

const REFUSE_MS = 260;

const tell = (command: "hide_capture" | "show_capture") => {
  if (isTauri()) void invoke(command).catch(() => undefined);
};

const saveAtom = atomRuntime.fn<ResolvedCapture>()(
  Effect.fnUntraced(function* (capture) {
    const backend = yield* Backend;
    const { taskId } = yield* backend.change(api.planner.tasks.create, captureArgs(capture));
    yield* Effect.forEach(capture.freshLabels, (label) => backend.change(api.planner.labels.create, { ...label, taskId }).pipe(Effect.ignoreCause), {
      concurrency: "unbounded",
      discard: true,
    });
  }),
  { concurrent: true },
);

const Capture = ({ today }: { today: IsoDate }) => {
  const sidebar = valueOf(useQuietView(api.planner.sidebar.get, { date: today }));
  const model = useCapture("", today, sidebar);
  const saved = useAtomValue(saveAtom);
  const send = useAtomSet(saveAtom, { mode: "promiseExit" });
  const forget = useAtomSet(saveAtom);
  const failed = AsyncResult.isFailure(saved) && !saved.waiting;
  const [refused, setRefused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { setText } = model;

  useEffect(() => {
    const focus = () => input.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") tell("hide_capture");
    };
    focus();
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(false), REFUSE_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  const save = (another: boolean) => {
    const { capture, text } = model;
    if (capture.title.trim() === "") return setRefused(true);
    void send(capture).then((exit) => {
      if (Exit.isSuccess(exit) || Exit.hasInterrupts(exit)) return;
      setText(text);
      tell("show_capture");
    });
    model.reset();
    if (!another) tell("hide_capture");
  };

  return (
    <QuickCapturePanel
      inputRef={input}
      value={model.text}
      onValueChange={(value) => {
        if (failed) forget(Atom.Reset);
        setText(value);
      }}
      onSave={save}
      chips={model.chips}
      onDismissChip={model.dismiss}
      destination={model.destination}
      failed={failed}
      refused={refused}
    />
  );
};

export const CaptureWindow = () => {
  const today = useLocalDate();
  useEffect(() => {
    document.documentElement.classList.add("capture-window");
    return () => document.documentElement.classList.remove("capture-window");
  }, []);
  const { isAuthenticated, isLoading } = useConvexAuth();
  return (
    <main className="p-6 select-none">
      {isAuthenticated && today ? (
        <Capture today={today} />
      ) : (
        !isLoading && (
          <p className="rounded-2xl bg-popover px-5 py-4 text-small text-muted-foreground shadow-float">
            Open LifeOS and sign in, then capture from here.
          </p>
        )
      )}
    </main>
  );
};

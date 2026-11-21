"use client";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useConvex, useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import { QuickCapturePanel } from "@/components/lifeos/quick-capture";
import { captureArgs } from "@lifeos/backend/client/capture-model";
import { useCapture } from "./command-bar/use-capture";
import { useLocalDate, useQuietView, valueOf } from "./hooks";

const REFUSE_MS = 260;

const tell = (command: "hide_capture" | "show_capture") => {
  if (isTauri()) void invoke(command).catch(() => undefined);
};

const Capture = ({ today }: { today: IsoDate }) => {
  const convex = useConvex();
  const sidebar = valueOf(useQuietView(api.planner.sidebar.get, { date: today }));
  const model = useCapture("", today, sidebar);
  const [failed, setFailed] = useState(false);
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
    const keep = () => {
      setText(text);
      setFailed(true);
      tell("show_capture");
    };
    convex.mutation(api.planner.tasks.create, captureArgs(capture)).then((result) => {
      if (!result.ok) return keep();
      for (const label of capture.freshLabels) {
        void convex.mutation(api.planner.labels.create, { ...label, taskId: result.value.taskId }).catch(() => undefined);
      }
    }, keep);
    setFailed(false);
    model.reset();
    if (!another) tell("hide_capture");
  };

  return (
    <QuickCapturePanel
      inputRef={input}
      value={model.text}
      onValueChange={(value) => {
        setFailed(false);
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

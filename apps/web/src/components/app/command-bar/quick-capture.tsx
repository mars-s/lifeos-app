"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { SidebarView } from "@lifeos/backend/types";
import { QuickCapturePanel } from "@/components/lifeos/quick-capture";
import { nothing, patchSidebar, useChange } from "../changes";
import { drafts } from "../drafts";
import { knownTaskIds } from "../new-task";
import { PLANNER_SLOT } from "../planner/lists";
import { routeHref, type Route } from "../route";
import { useShell } from "../shell-context";
import { captureArgs, type ResolvedCapture } from "./capture-model";
import { BarDialog } from "./dialog";
import { bar } from "./store";
import { useCapture } from "./use-capture";

const REFUSE_MS = 260;

const slotFor = (capture: ResolvedCapture, route: Route, today: string) => {
  const { when, list } = capture;
  if (route.kind === "planner" && when.kind === "inbox") return PLANNER_SLOT;
  if (route.kind === "planner" && when.kind === "scheduled") return `${PLANNER_SLOT}:${when.date <= today ? today : when.date}`;
  if (list && when.kind === "anytime") return routeHref({ kind: list.kind, id: list.id } as Route);
  if (when.kind === "scheduled") return when.date <= today ? "/today" : "/upcoming";
  return `/${when.kind}`;
};

const countsFor = (capture: ResolvedCapture, today: string) => (sidebar: SidebarView) => ({
  ...sidebar,
  counts: {
    inbox: sidebar.counts.inbox + (capture.when.kind === "inbox" ? 1 : 0),
    today: sidebar.counts.today + (capture.when.kind === "scheduled" && capture.when.date <= today ? 1 : 0),
  },
});

export const QuickCapture = ({ initial, failed, sidebar }: { initial: string; failed: boolean; sidebar: SidebarView | undefined }) => {
  const { today, route } = useShell();
  const change = useChange();
  const model = useCapture(initial, today, sidebar);
  const [refused, setRefused] = useState(false);
  const [stale, setStale] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(false), REFUSE_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  const save = (another: boolean) => {
    const { capture, text } = model;
    if (capture.title.trim() === "") return setRefused(true);
    const area = capture.list?.area;
    const project = capture.list?.kind === "project" ? { _id: capture.list.id, title: capture.list.title } : undefined;
    const key = drafts.add(
      slotFor(capture, route, today),
      {
        title: capture.title,
        notes: "",
        when: capture.when,
        parent:
          capture.list?.kind === "area"
            ? { kind: "area", areaId: capture.list.id }
            : capture.list?.kind === "project"
              ? { kind: "project", projectId: capture.list.id }
              : { kind: "loose" },
        labelIds: capture.labels.map((label) => label._id),
        status: { kind: "open" },
        order: "~",
        context: capture.list?.title,
        area,
        project,
        labels: [...capture.labels],
        checklist: [],
        workBlocks: [],
        focus: { ms: 0, sessions: [] },
        ...(capture.deadline ? { deadline: capture.deadline } : {}),
        ...(capture.estimateMinutes === undefined ? {} : { estimateMinutes: capture.estimateMinutes }),
      },
      knownTaskIds(),
    );
    void change({
      title: `Captured to ${model.destination}`,
      mutation: api.planner.tasks.create,
      args: captureArgs(capture),
      apply: patchSidebar(countsFor(capture, today)),
      revert: nothing,
      onSaved: ({ taskId }) => {
        drafts.saved(key, taskId);
        drafts.release(key);
        for (const label of capture.freshLabels) {
          void change({
            title: `Labelled ${label.name}`,
            mutation: api.planner.labels.create,
            args: { ...label, taskId },
            apply: nothing,
            revert: nothing,
            silent: true,
          });
        }
      },
    }).then((saved) => {
      if (saved) return;
      drafts.failed(key);
      bar.capture(text, true);
    });
    if (!another) return bar.close();
    model.reset();
    setStale(true);
    input.current?.focus();
  };

  return (
    <BarDialog title="Quick capture" onClose={bar.close} caretAtEnd={input}>
      <QuickCapturePanel
        inputRef={input}
        value={model.text}
        onValueChange={(value) => {
          setStale(true);
          model.setText(value);
        }}
        onSave={save}
        chips={model.chips}
        onDismissChip={model.dismiss}
        destination={model.destination}
        failed={failed && !stale}
        refused={refused}
      />
    </BarDialog>
  );
};

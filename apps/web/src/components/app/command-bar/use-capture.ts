"use client";

import { useMemo, useState } from "react";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import type { SidebarView } from "@lifeos/backend/types";
import { useQuietView } from "../hooks";
import { chipView, destinationOf } from "./capture-chips";
import { captureLists, resolveCapture } from "@lifeos/backend/client/capture-model";

const NO_LABELS: never[] = [];

export const useCapture = (initial: string, today: IsoDate, sidebar: SidebarView | undefined) => {
  const [text, setText] = useState(initial);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const labels = useQuietView(api.planner.labels.list, {}) ?? NO_LABELS;
  const lists = useMemo(() => captureLists(sidebar), [sidebar]);
  const capture = useMemo(() => resolveCapture(text, today, ignored, labels, lists), [text, today, ignored, labels, lists]);
  const chips = useMemo(() => capture.chips.map((chip) => chipView(chip, today)), [capture, today]);
  return {
    text,
    capture,
    chips,
    destination: destinationOf(capture.when, capture.list, today),
    setText,
    dismiss: (token: string) => setIgnored((current) => new Set([...current, token, ...token.replace(/^!/, "").split(/\s+/)])),
    reset: () => {
      setText("");
      setIgnored(new Set());
    },
  };
};

"use client";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useConvex } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { useLocalDate, useView, valueOf } from "./hooks";

const TICK_POLL_MS = 30_000;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const convexUrl = import.meta.env.WAKU_PUBLIC_CONVEX_URL;
const ignore = () => undefined;

const MacWidgetSync = () => {
  const convex = useConvex();
  const date = useLocalDate();
  const snapshot = valueOf(useView(api.planner.widgets.snapshot, date ? { date, timeZone } : "skip"));
  const written = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const shape = { v: 1, convexUrl, ...snapshot };
    const key = JSON.stringify(shape);
    if (key === written.current) return;
    written.current = key;
    void invoke("write_widget_snapshot", { json: JSON.stringify({ ...shape, writtenAt: Date.now() }) }).catch(ignore);
  }, [snapshot]);

  useEffect(() => {
    const sending = new Set<string>();
    const send = async () => {
      const waiting = (await invoke<string[]>("pending_widget_ticks").catch(() => [])).filter((taskId) => !sending.has(taskId));
      for (const taskId of waiting) {
        sending.add(taskId);
        void convex
          .mutation(api.planner.tasks.complete, { taskId: taskId as Id<"tasks"> })
          .then((result) => (result.ok || result.error.kind === "not_found" ? invoke("clear_widget_ticks", { taskIds: [taskId] }) : undefined))
          .catch(ignore)
          .finally(() => sending.delete(taskId));
      }
    };
    void send();
    const timer = setInterval(() => void send(), TICK_POLL_MS);
    window.addEventListener("focus", send);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", send);
    };
  }, [convex]);

  return null;
};

export const WidgetSync = () => (isTauri() ? <MacWidgetSync /> : null);

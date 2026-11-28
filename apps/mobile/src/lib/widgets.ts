import { useAuthToken } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import { widgets } from "../../modules/lifeos-widgets";
import { convex, convexUrl } from "@/lib/convex";
import { useLocalDate, useView, valueOf } from "@/lib/views";

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const sending = new Set<string>();

const sendTicks = () => {
  if (!widgets || !convex) return;
  const client = convex;
  const waiting = widgets.pendingTicks().filter((taskId) => !sending.has(taskId));
  for (const taskId of waiting) {
    sending.add(taskId);
    void client
      .mutation(api.planner.tasks.complete, { taskId: taskId as Id<"tasks"> })
      .then((result) => {
        if (result.ok || result.error.kind === "not_found") widgets?.clearTicks([taskId]);
      })
      .catch(() => undefined)
      .finally(() => sending.delete(taskId));
  }
};

export const useWidgetSync = () => {
  const date = useLocalDate();
  const token = useAuthToken();
  const snapshot = valueOf(useView(api.planner.widgets.snapshot, { date, timeZone }));
  const written = useRef<{ key: string; shape: object } | null>(null);
  const focus = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    widgets?.setToken(token);
  }, [token]);

  useEffect(() => {
    if (!widgets || !snapshot) return;
    const shape = { v: 1, convexUrl, ...snapshot };
    const key = JSON.stringify(shape);
    if (key !== written.current?.key) {
      written.current = { key, shape };
      widgets.writeSnapshot(JSON.stringify({ ...shape, writtenAt: Date.now() }));
    }
    const live = snapshot.focus ? JSON.stringify(snapshot.focus) : null;
    if (live !== focus.current) {
      focus.current = live;
      void widgets.syncFocus(live);
    }
  }, [snapshot]);

  useEffect(() => {
    sendTicks();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sendTicks();
      if (state === "background" && widgets && written.current)
        widgets.writeSnapshot(JSON.stringify({ ...written.current.shape, writtenAt: Date.now() }));
    });
    return () => subscription.remove();
  }, []);
};

"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

export const WindowDragStrip = () => {
  const inApp = useSyncExternalStore(subscribe, isTauri, () => false);
  if (!inApp) return null;
  return <div data-tauri-drag-region aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-7" />;
};

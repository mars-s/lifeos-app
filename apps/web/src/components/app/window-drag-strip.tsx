"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

export const useInApp = () => useSyncExternalStore(subscribe, isTauri, () => false);

export const WindowDragStrip = () => {
  const inApp = useInApp();
  if (!inApp) return null;
  return <div data-tauri-drag-region aria-hidden="true" className="fixed top-0 right-0 left-0 z-[60] h-7 md:left-60 lg:left-64" />;
};

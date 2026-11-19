import { useSyncExternalStore } from "react";
import type { PermissionStatus } from "./mac";

const STATUS = { default: "notAsked", denied: "denied", granted: "granted" } as const satisfies Record<NotificationPermission, PermissionStatus>;

const listeners = new Set<() => void>();

const webAlertStatus = () => ("Notification" in window ? STATUS[Notification.permission] : "missing");

const readMissing = () => "missing" as const;

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  window.addEventListener("focus", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("focus", onChange);
  };
};

export const useWebAlertStatus = () => useSyncExternalStore<PermissionStatus>(subscribe, webAlertStatus, readMissing);

export const askForWebAlerts = () => {
  if (webAlertStatus() !== "notAsked") return;
  void Notification.requestPermission().then(() => listeners.forEach((listener) => listener()));
};

export const showWebAlert = ({ title, body }: { title: string; body: string }) => {
  const watching = document.visibilityState === "visible" && document.hasFocus();
  if (watching || webAlertStatus() !== "granted") return;
  const note = new Notification(title, { body, tag: "lifeos-focus", icon: "/favicon.svg" });
  note.addEventListener("click", () => {
    window.focus();
    note.close();
  });
};

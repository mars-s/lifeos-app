import { invoke, isTauri } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export const PERMISSIONS = ["calendar", "thingsData", "keychain"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type PermissionStatus = "granted" | "denied" | "notAsked" | "missing";
export type Permissions = Record<Permission, PermissionStatus>;
export type Run = { atMs: number; error: string | null };
export type SyncReport = { things: Run | null; calendar: Run | null };

export type Mac = {
  permissions: () => Promise<Permissions>;
  request: (permission: Permission) => Promise<PermissionStatus>;
  onboarded: () => Promise<boolean>;
  finishOnboarding: () => Promise<void>;
  syncReport: () => Promise<SyncReport>;
  importThingsNow: () => Promise<void>;
};

const tauriMac: Mac = {
  permissions: () => invoke("permissions"),
  request: (permission) => invoke("request_permission", { permission }),
  onboarded: () => invoke("onboarded"),
  finishOnboarding: () => invoke("finish_onboarding"),
  syncReport: () => invoke("sync_report"),
  importThingsNow: () => invoke("import_things_now"),
};

const PREVIEWS = {
  fresh: { calendar: "notAsked", thingsData: "notAsked", keychain: "notAsked" },
  ready: { calendar: "granted", thingsData: "granted", keychain: "granted" },
  trouble: { calendar: "denied", thingsData: "granted", keychain: "missing" },
} as const satisfies Record<string, Permissions>;

const PREVIEW_ANSWER_MS = 500;

const previewMac = (name: keyof typeof PREVIEWS) => {
  const state: Permissions = { ...PREVIEWS[name] };
  let onboarded = name !== "fresh";
  let things: Run | null = name === "fresh" ? null : { atMs: Date.now() - 120_000, error: null };
  const calendar: Run | null =
    name === "trouble" ? { atMs: Date.now() - 240_000, error: "could not reach Convex: timed out" } : things;
  return {
    permissions: () => Promise.resolve({ ...state }),
    request: (permission) =>
      new Promise((resolve) => {
        setTimeout(() => {
          if (state[permission] === "notAsked") state[permission] = "granted";
          resolve(state[permission]);
        }, PREVIEW_ANSWER_MS);
      }),
    onboarded: () => Promise.resolve(onboarded),
    finishOnboarding: () => {
      onboarded = true;
      return Promise.resolve();
    },
    syncReport: () => Promise.resolve({ things, calendar }),
    importThingsNow: () => {
      things = { atMs: Date.now(), error: null };
      return Promise.resolve();
    },
  } satisfies Mac;
};

let demo: Mac | undefined;

export const demoMac = () => (demo ??= previewMac("fresh"));

const previewName = () => {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(window.location.search).get("__mac");
  return name !== null && name in PREVIEWS ? (name as keyof typeof PREVIEWS) : null;
};

let resolved: Mac | null | undefined;

const readMac = () => {
  if (resolved !== undefined) return resolved;
  const preview = previewName();
  resolved = isTauri() ? tauriMac : preview ? previewMac(preview) : null;
  return resolved;
};

const subscribe = () => () => undefined;
const readNothing = () => null;

export const useMac = () => useSyncExternalStore(subscribe, readMac, readNothing);

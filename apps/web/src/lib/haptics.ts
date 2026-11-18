import { invoke, isTauri } from "@tauri-apps/api/core";
import { WebHaptics } from "web-haptics";

export type Haptic = "snap" | "drop" | "complete" | "error" | "toggle";

type TrackpadPattern = "alignment" | "levelChange" | "generic";

const TRACKPAD = {
  snap: ["alignment"],
  toggle: ["alignment"],
  drop: ["levelChange"],
  complete: ["generic"],
  error: ["generic", "generic"],
} as const satisfies Record<Haptic, readonly TrackpadPattern[]>;

const PHONE = {
  snap: "selection",
  toggle: "light",
  drop: "medium",
  complete: "success",
  error: "error",
} as const satisfies Record<Haptic, string>;

const SNAP_GAP_MS = 50;
const KNOCK_GAP_MS = 90;

let lastSnapAt = 0;
let phone: WebHaptics | undefined;

const ignore = () => undefined;

const knock = (pattern: TrackpadPattern) => {
  invoke("haptic", { pattern }).catch(ignore);
};

const tooSoon = (kind: Haptic) => {
  if (kind !== "snap") return false;
  const now = performance.now();
  if (now - lastSnapAt < SNAP_GAP_MS) return true;
  lastSnapAt = now;
  return false;
};

export const haptic = (kind: Haptic) => {
  if (typeof window === "undefined" || tooSoon(kind)) return;
  if (isTauri()) {
    const [first, ...rest] = TRACKPAD[kind];
    knock(first);
    rest.forEach((pattern, index) => setTimeout(knock, (index + 1) * KNOCK_GAP_MS, pattern));
    return;
  }
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  phone ??= new WebHaptics();
  phone.trigger(PHONE[kind]).catch(ignore);
};

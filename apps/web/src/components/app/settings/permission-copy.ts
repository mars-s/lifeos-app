import { CalendarDots, Database, Key, type Icon } from "@phosphor-icons/react";
import type { Permission, PermissionStatus } from "@/lib/mac";
import type { LampTone } from "./rows";

export const PERMISSION_COPY = {
  calendar: {
    label: "Apple Calendar",
    icon: CalendarDots,
    why: "So your plans leave room for the events already in your day. LifeOS only reads them.",
    denied: "macOS said no. Switch LifeOS on under Calendars in System Settings.",
    missing: "This Mac has no calendars to read.",
    missingWord: "Not here",
    reask: "Open System Settings",
  },
  thingsData: {
    label: "Things data",
    icon: Database,
    why: "So your Tasks keep coming across from Things until Switch Day. Nothing is ever written to Things.",
    denied: "macOS said no. Ask again and choose Allow.",
    missing: "Things is not on this Mac, so there is nothing to import.",
    missingWord: "Not installed",
    reask: "Ask again",
  },
  keychain: {
    label: "Keychain token",
    icon: Key,
    why: "The key this Mac uses to send your Tasks and calendar to LifeOS. It stays in your Keychain.",
    denied: "macOS did not hand over the token. Ask again and choose Always Allow.",
    missing: "No Worker token on this Mac yet. The README has the one command that adds it.",
    missingWord: "No token",
    reask: "Ask again",
  },
} as const satisfies Record<Permission, { label: string; icon: Icon; why: string; denied: string; missing: string; missingWord: string; reask: string }>;

export const statusWord = (permission: Permission, status: PermissionStatus) =>
  status === "granted" ? "Allowed" : status === "denied" ? "Not allowed" : status === "notAsked" ? "Not asked" : PERMISSION_COPY[permission].missingWord;

const TONE = { granted: "positive", denied: "negative", notAsked: "quiet", missing: "quiet" } as const satisfies Record<PermissionStatus, LampTone>;

export const statusTone = (status: PermissionStatus) => TONE[status];

export const actionLabel = (permission: Permission, status: PermissionStatus) =>
  status === "notAsked" ? "Allow" : status === "denied" ? PERMISSION_COPY[permission].reask : null;

export const statusHint = (permission: Permission, status: PermissionStatus) =>
  status === "denied" ? PERMISSION_COPY[permission].denied : status === "missing" ? PERMISSION_COPY[permission].missing : PERMISSION_COPY[permission].why;

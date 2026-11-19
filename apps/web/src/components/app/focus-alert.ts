import { isLongBreak, plannedMs, type FocusClock, type Pomodoro } from "@lifeos/backend/focus";
import type { FocusPillView } from "../lifeos/focus-timer";
import { formatCountdown } from "../lifeos/format";

type Watched = FocusClock & { readonly kind: "focus" | "break"; readonly title: string; readonly pomodoro?: Pomodoro };

export const timeUpAlert = (session: Watched) => {
  const planned = plannedMs(session);
  if (session.state.kind !== "running" || planned === undefined) return null;
  const endsAt = session.start + session.pausedMs + planned;
  if (session.kind === "break") return { endsAt, title: "Break over", body: `Back to ${session.title}.` };
  const rest = session.pomodoro && isLongBreak(session.pomodoro) ? "a long break" : "a break";
  return { endsAt, title: "Focus Session complete", body: `Time for ${rest} from ${session.title}.` };
};

export const tabTitle = ({ title, phase, status, seconds, longBreak }: FocusPillView) => {
  if (status === "done") return `${phase === "break" ? "Break over" : "Time is up"} · ${title}`;
  const what = phase === "break" ? (longBreak ? "Long break" : "Break") : title;
  return `${formatCountdown(Math.max(0, seconds))}${status === "paused" ? " paused" : ""} · ${what}`;
};

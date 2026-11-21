import type { FocusPillView } from "../lifeos/focus-timer";
import { formatCountdown } from "../lifeos/format";

export const tabTitle = ({ title, phase, status, seconds, longBreak }: FocusPillView) => {
  if (status === "done") return `${phase === "break" ? "Break over" : "Time is up"} · ${title}`;
  const what = phase === "break" ? (longBreak ? "Long break" : "Break") : title;
  return `${formatCountdown(Math.max(0, seconds))}${status === "paused" ? " paused" : ""} · ${what}`;
};

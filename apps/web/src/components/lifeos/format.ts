export const round = (value: number) => Math.round(value * 100) / 100;

export { formatMinutes } from "@lifeos/backend/estimate";

const clockParts = (minuteOfDay: number) => {
  const hour = Math.floor(minuteOfDay / 60);
  return {
    time: `${((hour + 11) % 12) + 1}:${String(minuteOfDay % 60).padStart(2, "0")}`,
    meridiem: hour < 12 ? "am" : "pm",
  };
};

export const formatClock = (minuteOfDay: number) => {
  const { time, meridiem } = clockParts(minuteOfDay);
  return `${time} ${meridiem}`;
};

export const formatRange = (start: number, end: number) => {
  const from = clockParts(start);
  const to = clockParts(end);
  return from.meridiem === to.meridiem
    ? `${from.time} – ${to.time} ${to.meridiem}`
    : `${from.time} ${from.meridiem} – ${to.time} ${to.meridiem}`;
};

export const formatCountdown = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

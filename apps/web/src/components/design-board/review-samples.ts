import type { ActivityDay } from "@/components/lifeos/activity-timeline";

const noise = (seed: number) => {
  const wave = Math.sin(seed * 12.9898) * 43758.5453;
  return wave - Math.floor(wave);
};

const ACTIVITY_DAYS = 63;
const LAST_DAY = Date.UTC(2026, 10, 18);
export const activitySample = () => {
  const dayLabel = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  return Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
    const date = new Date(LAST_DAY - (ACTIVITY_DAYS - 1 - index) * 86_400_000);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const swell = 2.4 + Math.sin(index / 6) * 1.6;
    return {
      label: dayLabel.format(date),
      count: Math.max(0, Math.min(6, Math.round((weekend ? 0.4 : 1) * swell + noise(index) * 2.4))),
    } satisfies ActivityDay;
  });
};

export const HEAT_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const HEAT_HOURS = Array.from({ length: 14 }, (_, index) => index + 7);
export const HEAT_MINUTES = HEAT_WEEKDAYS.map((_, day) =>
  HEAT_HOURS.map((hour) => {
    const morning = Math.exp(-((hour - 10) ** 2) / 5);
    const evening = Math.exp(-((hour - 16) ** 2) / 7) * 0.7;
    const weight = day > 4 ? 0.3 : 1;
    const value = (morning + evening) * weight * 150 + noise(day * 31 + hour) * 40 - 22;
    return Math.max(0, Math.round(value / 5) * 5);
  }),
);

import type { MutationCtx } from "../_generated/server";
import { zonedMoment } from "../calendar/model";
import { addDays, type IsoDate } from "../../shared/date";

const NIGHTS: [bedMinute: number, wakeMinute: number, score: number][] = [
  [-62, 395, 82],
  [-45, 410, 86],
  [-80, 385, 74],
  [-30, 420, 88],
  [-55, 400, 81],
  [-70, 390, 77],
  [-40, 415, 84],
  [-65, 405, 79],
  [-50, 395, 83],
  [-35, 410, 85],
];

export const seedSleep = async (ctx: MutationCtx, today: IsoDate, timeZone: string) => {
  const now = Date.now();
  const offsetMinutes = Math.round((zonedMoment(today, 0, "UTC") - zonedMoment(today, 0, timeZone)) / 60_000);
  for (const [index, [bed, wake, score]] of NIGHTS.entries()) {
    const day = addDays(today, -index);
    const start = zonedMoment(day, bed, timeZone);
    const end = zonedMoment(day, wake, timeZone);
    await ctx.db.insert("healthDays", {
      source: "oura",
      day,
      sleep: { start, end, offsetMinutes, asleepMinutes: Math.round((end - start) / 60_000) - 28 },
      sleepScore: score,
      readinessScore: score - 3,
      sleepTime: {
        status: "optimal_found",
        recommendation: "follow_optimal_bedtime",
        window: { startOffset: -5400, endOffset: -1800, dayTz: offsetMinutes * 60 },
      },
      syncedAt: now,
    });
  }
  await ctx.db.insert("ouraConnection", {
    accessToken: "seed",
    refreshToken: "seed",
    expiresAt: now + 86_400_000,
    scope: "daily",
    connectedAt: now,
    sync: { kind: "ok", at: now - 40 * 60_000 },
  });
};

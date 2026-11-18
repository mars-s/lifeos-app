import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.cron("pull sleep from Oura", "15 */4 * * *", internal.health.oura.sync, {});
export default crons;

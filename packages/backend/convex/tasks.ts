import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const SAMPLE_TASKS = [
  { title: "Plan the week in ten quiet minutes", area: "Personal" },
  { title: "Read one chapter for uni", area: "Study" },
  { title: "Walk before lunch", area: "Health" },
];

export const seedSample = internalMutation({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_scheduledFor", (q) => q.eq("scheduledFor", date))
      .collect();
    const existingTitles = new Set(existing.map((task) => task.title));
    const missing = SAMPLE_TASKS.filter((task) => !existingTitles.has(task.title));
    for (const task of missing) {
      await ctx.db.insert("tasks", { ...task, status: "open", scheduledFor: date });
    }
    return { inserted: missing.length };
  },
});

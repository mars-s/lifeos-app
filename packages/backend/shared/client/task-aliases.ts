import type { Id } from "../../convex/_generated/dataModel";

const realIds = new Map<string, Id<"tasks">>();

export const taskAliases = {
  set: (key: string, taskId: Id<"tasks">) => void realIds.set(key, taskId),
  get: (key: string) => realIds.get(key),
  realId: (id: string) => realIds.get(id) ?? (id as Id<"tasks">),
};

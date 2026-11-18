import type { PlannerTask } from "@lifeos/backend/types";

export const planCommands: { addBlock: ((task: PlannerTask) => void) | null } = { addBlock: null };

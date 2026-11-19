import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";

export const planCommands: {
  addBlock: ((task: PlannerTask) => void) | null;
  spread: ((date: IsoDate) => void) | null;
  pending: IsoDate | null;
} = { addBlock: null, spread: null, pending: null };

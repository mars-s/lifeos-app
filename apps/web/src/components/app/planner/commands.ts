import type { IsoDate } from "@lifeos/backend/date";
import type { PlannerTask } from "@lifeos/backend/types";

export const planCommands: {
  addBlock: ((task: PlannerTask) => void) | null;
  reveal: ((date: IsoDate) => void) | null;
  spread: ((date: IsoDate) => void) | null;
  smartBlock: ((date: IsoDate) => void) | null;
  pending: IsoDate | null;
  pendingSmartBlock: IsoDate | null;
} = { addBlock: null, reveal: null, spread: null, smartBlock: null, pending: null, pendingSmartBlock: null };

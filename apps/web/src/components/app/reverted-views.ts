"use client";

import { useMemo, useSyncExternalStore } from "react";
import { noReverted, readReverted, subscribeReverted, withReverted } from "@lifeos/backend/client/reverted";

export const useReverted = (name: string, argsKey: string | null, live: unknown) => {
  const pending = useSyncExternalStore(subscribeReverted, readReverted, noReverted);
  return useMemo(() => withReverted(pending, name, argsKey, live), [pending, name, argsKey, live]);
};

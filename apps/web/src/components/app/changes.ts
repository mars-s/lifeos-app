"use client";

import { useConvex } from "convex/react";
import { useMemo } from "react";
import { createChange } from "@lifeos/backend/client/change";
import { showUndo } from "@/components/lifeos/undo";
import { toast } from "@/components/ui/toast-stack";
import { drafts, isDraftTask } from "./drafts";

export type { Change } from "@lifeos/backend/client/change";
export type { Updater } from "@lifeos/backend/client/local-views";
export { reasonFor } from "@lifeos/backend/client/reasons";
export * from "@lifeos/backend/client/updaters";

export const useChange = () => {
  const convex = useConvex();
  return useMemo(
    () =>
      createChange({
        mutate: (mutation, args, options) => convex.mutation(mutation, args, options),
        showUndo,
        say: (title) => void toast(title),
        refuse: (title, reason) => void toast.error(title, { description: reason }),
        drafts: { isDraft: isDraftTask, rewrite: drafts.rewrite, whenSaved: drafts.whenSaved },
      }),
    [convex],
  );
};

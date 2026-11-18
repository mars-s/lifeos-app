"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useConvex } from "convex/react";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { TrashRow } from "@lifeos/backend/types";
import { toast } from "@/components/ui/toast-stack";
import { haptic } from "@/lib/haptics";
import { nothing, reasonFor, useChange } from "./changes";
import { askToConfirm } from "./confirm";

const MAX_PASSES = 200;

const quoted = (title: string) => (title.length > 28 ? `${title.slice(0, 27)}…` : title);

const itemsOf = (rows: readonly TrashRow[]) =>
  rows.map((row) =>
    row.kind === "task"
      ? { kind: row.kind, id: row.id }
      : row.kind === "project"
        ? { kind: row.kind, id: row.id }
        : { kind: row.kind, id: row.id },
  );

const dropRows = (rows: readonly TrashRow[] | "all") => (store: OptimisticLocalStore) => {
  const view = store.getQuery(api.planner.trash.list, {});
  if (!view) return;
  const gone = rows === "all" ? null : new Set<string>(rows.map((row) => row.id));
  store.setQuery(api.planner.trash.list, {}, { ...view, rows: gone ? view.rows.filter((row) => !gone.has(row.id)) : [] });
};

const NAMES = { task: "Task", project: "Project", area: "Area" } as const;

const whatGoes = (row: TrashRow) =>
  row.kind === "area"
    ? `The Area, its ${row.projects} Projects and ${row.tasks} Tasks that went to Trash with it`
    : row.kind === "project"
      ? `The Project and the ${row.tasks} Tasks that went to Trash with it`
      : "The Task, its notes and its Checklist";

export const useTrashActions = () => {
  const change = useChange();
  const convex = useConvex();
  return useMemo(() => {
    const refused = (kind: string | undefined) => {
      haptic("error");
      toast.error("That was not deleted", { description: reasonFor(kind) });
    };

    return {
      putBack: (rows: readonly TrashRow[]) => {
        const [first] = rows;
        if (!first) return;
        haptic("drop");
        void change({
          title: rows.length === 1 ? `${quoted(first.title)} put back` : `${rows.length} put back`,
          mutation: api.planner.trash.restore,
          args: { items: itemsOf(rows) },
          apply: dropRows(rows),
          revert: nothing,
        });
      },

      deleteForever: (row: TrashRow) =>
        askToConfirm({
          title: `Delete “${quoted(row.title)}” forever?`,
          body: `${whatGoes(row)} will be gone for good. This cannot be undone.`,
          action: `Delete ${NAMES[row.kind]}`,
          onConfirm: () => {
            convex.mutation(api.planner.trash.deleteForever, { items: itemsOf([row]) }, { optimisticUpdate: dropRows([row]) }).then(
              (result) => (result.ok ? toast(`${quoted(row.title)} deleted`) : refused(result.error.kind)),
              () => refused(undefined),
            );
          },
        }),

      empty: (count: number) =>
        askToConfirm({
          title: "Empty Trash?",
          body: `${count === 1 ? "The one item" : `All ${count} items`} in Trash will be gone for good. This cannot be undone.`,
          action: "Empty Trash",
          onConfirm: () => {
            const pass: (left: number) => Promise<boolean> = async (left) => {
              const result = await convex.mutation(api.planner.trash.empty, {}, { optimisticUpdate: dropRows("all") });
              if (!result.ok) return false;
              return result.value.done || left === 0 ? result.value.done : pass(left - 1);
            };
            pass(MAX_PASSES).then(
              (done) => (done ? toast("Trash emptied") : refused(undefined)),
              () => refused(undefined),
            );
          },
        }),
    };
  }, [change, convex]);
};

export type TrashActions = ReturnType<typeof useTrashActions>;

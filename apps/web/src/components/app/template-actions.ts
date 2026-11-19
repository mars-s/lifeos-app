"use client";

import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { generateKeyBetween } from "fractional-indexing";
import { useMemo } from "react";
import { api } from "@lifeos/backend/api";
import type { Id } from "@lifeos/backend/dataModel";
import type { PlannerTask, TemplateRow } from "@lifeos/backend/types";
import { useChange } from "./changes";
import { daysBetween } from "./dates";

type TemplateFields = Omit<FunctionArgs<typeof api.planner.templates.update>, "templateId">;

const MAX_OFFSET_DAYS = 365;

export const editTemplates = (edit: (rows: TemplateRow[]) => TemplateRow[]) => (store: OptimisticLocalStore) => {
  const rows = store.getQuery(api.planner.templates.list, {});
  if (rows) store.setQuery(api.planner.templates.list, {}, edit(rows));
};

const byOrder = (a: TemplateRow, b: TemplateRow) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

const put = (row: TemplateRow) => editTemplates((rows) => [...rows.filter((entry) => entry._id !== row._id), row].toSorted(byOrder));

const drop = (gone: (row: TemplateRow) => boolean) => editTemplates((rows) => rows.filter((row) => !gone(row)));

const offsetOf = (task: PlannerTask, today: string) => {
  if (!task.deadline) return {};
  const from = task.when.kind === "scheduled" ? task.when.date : today;
  return { deadlineOffsetDays: Math.min(Math.max(daysBetween(from, task.deadline), 0), MAX_OFFSET_DAYS) };
};

const templateFrom = (task: PlannerTask, today: string, order: string) =>
  ({
    _id: `optimistic:template:${order}` as Id<"templates">,
    _creationTime: Date.now(),
    title: task.title,
    notes: task.notes,
    ...(task.estimateMinutes === undefined ? {} : { estimateMinutes: task.estimateMinutes }),
    labelIds: task.labelIds,
    parent: task.parent,
    checklist: task.checklist.map((item) => item.title),
    ...offsetOf(task, today),
    order,
    labels: task.labels,
    checklistCount: task.checklist.length,
    area: task.area,
    project: task.project,
  }) satisfies TemplateRow;

export const useTemplateActions = () => {
  const change = useChange();
  return useMemo(
    () => ({
      save: (task: PlannerTask, today: string) => {
        let savedId: string | undefined;
        let order = "";
        void change({
          title: "Saved as a Template",
          mutation: api.planner.templates.saveFromTask,
          args: { taskId: task._id, today },
          apply: editTemplates((rows) => {
            order = generateKeyBetween(rows.at(-1)?.order ?? null, null);
            return [...rows, templateFrom(task, today, order)];
          }),
          revert: drop((row) => row._id === savedId || row._id === `optimistic:template:${order}`),
          onSaved: ({ templateId }) => {
            savedId = templateId;
          },
        });
      },

      edit: (template: TemplateRow, title: string, fields: TemplateFields, shown: (row: TemplateRow) => TemplateRow) =>
        void change({
          title,
          mutation: api.planner.templates.update,
          args: { templateId: template._id, ...fields },
          apply: editTemplates((rows) => rows.map((row) => (row._id === template._id ? shown(row) : row))),
          revert: put(template),
          slot: `template:${template._id}`,
        }),

      reorder: (template: TemplateRow, targetId: Id<"templates">, placement: "before" | "after", order: string) => {
        const place = (key: string) =>
          editTemplates((rows) => rows.map((row) => (row._id === template._id ? { ...row, order: key } : row)).toSorted(byOrder));
        void change({
          title: "Template moved",
          mutation: api.planner.templates.reorder,
          args: { templateId: template._id, targetId, placement },
          apply: place(order),
          revert: place(template.order),
        });
      },

      remove: (template: TemplateRow) =>
        void change({
          title: "Template deleted",
          mutation: api.planner.templates.remove,
          args: { templateId: template._id },
          apply: drop((row) => row._id === template._id),
          revert: put(template),
        }),
    }),
    [change],
  );
};

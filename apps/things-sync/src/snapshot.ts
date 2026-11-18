import { Result, err, ok } from "neverthrow";
import type { FunctionArgs } from "convex/server";
import type { api } from "@lifeos/backend/api";

export type ThingsSnapshot = FunctionArgs<typeof api.things.sync>["snapshot"];
type SnapshotTask = ThingsSnapshot["tasks"][number];
type ListName = SnapshotTask["list"];
type Status = SnapshotTask["status"];

type Column = {
  ids: string[];
  titles: string[];
  notes: string[];
  statuses: string[];
  starts: (string | null)[];
  deadlines: (string | null)[];
  tags: string[];
  areas: (string | null)[];
  modified: number[];
};

type ListColumn = Column & { projects: (string | null)[] };

export type RawThings = {
  lists: Record<ListName, ListColumn>;
  projects: Column;
  areas: { ids: string[]; titles: string[] };
};

export type SnapshotError =
  | { readonly kind: "misaligned_columns"; readonly where: string }
  | { readonly kind: "unknown_status"; readonly id: string; readonly status: string };

const LIST_PRECEDENCE: readonly ListName[] = ["today", "inbox", "upcoming", "someday", "anytime"];
const STATUSES: ReadonlySet<string> = new Set<Status>(["open", "completed", "canceled"]);

const isStatus = (value: string): value is Status => STATUSES.has(value);

const rowsOf = (column: Column, projects: (string | null)[] | undefined, where: string) => {
  const columns = [column.titles, column.notes, column.statuses, column.starts, column.deadlines, column.tags, column.areas, column.modified];
  const aligned = [...columns, ...(projects ? [projects] : [])].every((values) => values.length === column.ids.length);
  if (!aligned) return err<never, SnapshotError>({ kind: "misaligned_columns", where });
  return Result.combine(
    column.ids.map((id, i) => {
      const status = column.statuses[i] ?? "";
      if (!isStatus(status)) return err<never, SnapshotError>({ kind: "unknown_status", id, status });
      const start = column.starts[i];
      const deadline = column.deadlines[i];
      const area = column.areas[i];
      const project = projects?.[i];
      return ok({
        thingsId: id,
        title: column.titles[i] ?? "",
        notes: column.notes[i] ?? "",
        status,
        tags: (column.tags[i] ?? "").split(", ").filter(Boolean),
        modifiedAt: column.modified[i] ?? 0,
        position: i,
        ...(start ? { scheduledFor: start } : {}),
        ...(deadline ? { deadline } : {}),
        ...(area ? { areaThingsId: area } : {}),
        ...(project ? { projectThingsId: project } : {}),
      });
    }),
  );
};

export const toSnapshot = (raw: RawThings) =>
  rowsOf(raw.projects, undefined, "projects").andThen((projectRows) => {
    const projectIds = new Set(projectRows.map((project) => project.thingsId));
    return Result.combine(
      LIST_PRECEDENCE.map((list) =>
        rowsOf(raw.lists[list], raw.lists[list].projects, list).map((rows) =>
          rows.map((row) => ({ ...row, list }) satisfies SnapshotTask),
        ),
      ),
    ).map((listRows) => {
      const tasks = new Map<string, SnapshotTask>();
      for (const row of listRows.flat()) {
        if (!projectIds.has(row.thingsId) && !tasks.has(row.thingsId)) tasks.set(row.thingsId, row);
      }
      return {
        areas: raw.areas.ids.map((id, position) => ({ thingsId: id, title: raw.areas.titles[position] ?? "", position })),
        projects: projectRows
          .filter((project) => project.status === "open")
          .map(({ modifiedAt: _modifiedAt, ...project }) => project),
        tasks: [...tasks.values()],
      } satisfies ThingsSnapshot;
    });
  });

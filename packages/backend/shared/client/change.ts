import type { DefaultFunctionArgs, FunctionArgs, FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { SerialisedResult } from "../result";
import type { Updater } from "./local-views";
import { reasonFor } from "./reasons";
import { showReverted } from "./reverted";
import { taskAliases } from "./task-aliases";
import { nothing } from "./updaters";

type ChangeResult = SerialisedResult<{ activityId: Id<"activity"> | null }, { kind: string }>;
export type ChangeMutation = FunctionReference<"mutation", "public", DefaultFunctionArgs, ChangeResult>;
type SavedValue<Mutation extends ChangeMutation> = Extract<Mutation["_returnType"], { ok: true }>["value"];

export type Change<Mutation extends ChangeMutation> = {
  title: string;
  mutation: Mutation;
  args: FunctionArgs<Mutation>;
  apply: Updater;
  revert: Updater;
  slot?: string;
  permanent?: boolean;
  silent?: boolean;
  onSaved?: (value: SavedValue<Mutation>) => void;
  onUndo?: () => void;
  onUndone?: () => void;
};

export type ChangeHost = {
  mutate: (mutation: ChangeMutation, args: DefaultFunctionArgs, options: { optimisticUpdate: Updater }) => Promise<ChangeResult>;
  showUndo: (title: string, undo: () => void, slot?: string) => () => void;
  say: (title: string) => void;
  refuse: (title: string, reason: string) => void;
  drafts: {
    isDraft: (id: string) => boolean;
    rewrite: (key: string, update: Updater) => void;
    whenSaved: (key: string) => Promise<Id<"tasks"> | null>;
  };
};

export const noDrafts = {
  isDraft: () => false,
  rewrite: nothing,
  whenSaved: (key: string) => Promise.resolve(taskAliases.get(key) ?? null),
} satisfies ChangeHost["drafts"];

const DISCARDED = "draft_discarded";

export const createChange = ({ mutate, showUndo, say, refuse, drafts }: ChangeHost) => {
  const draftsIn = (args: DefaultFunctionArgs) =>
    [args.taskId, ...(Array.isArray(args.taskIds) ? (args.taskIds as unknown[]) : [])].filter(
      (id): id is string => typeof id === "string" && drafts.isDraft(id),
    );

  const send = async (mutation: ChangeMutation, args: DefaultFunctionArgs, unsaved: readonly string[], optimisticUpdate: Updater, wanted: () => boolean) => {
    const discarded = unsaved.length > 0 && (await Promise.all(unsaved.map(drafts.whenSaved))).includes(null);
    if (discarded || !wanted()) return { ok: false, error: { kind: DISCARDED } } satisfies ChangeResult;
    const taskId = typeof args.taskId === "string" ? { taskId: taskAliases.realId(args.taskId) } : {};
    const taskIds = Array.isArray(args.taskIds) ? { taskIds: args.taskIds.map((id) => taskAliases.realId(String(id))) } : {};
    return mutate(mutation, { ...args, ...taskId, ...taskIds }, { optimisticUpdate });
  };

  const undo = async (sent: Promise<Id<"activity"> | null>, revert: Updater, onUndone: (() => void) | undefined) => {
    const lift = showReverted(revert);
    const activityId = await sent;
    if (!activityId) return lift();
    const undoing = mutate(api.platform.undo.undo as unknown as ChangeMutation, { activityId }, { optimisticUpdate: revert });
    lift();
    const result = await undoing.catch(() => undefined);
    if (!result?.ok) refuse("That could not be undone", reasonFor(result?.error.kind));
    else onUndone?.();
  };

  return <Mutation extends ChangeMutation>({ title, mutation, args, apply, revert, slot, permanent, silent, onSaved, onUndo, onUndone }: Change<Mutation>) => {
    const unsaved = draftsIn(args);
    let undone = false;
    unsaved.forEach((key) => drafts.rewrite(key, apply));
    const refused = (kind: string | undefined) => {
      forget();
      if (kind !== DISCARDED && !undone) refuse("That did not save", reasonFor(kind));
      return { saved: false, activityId: null };
    };
    const sent = send(mutation, args, unsaved, apply, () => !undone).then(
      (result) => {
        if (!result.ok) return refused(result.error.kind);
        onSaved?.(result.value as SavedValue<Mutation>);
        if (permanent) say(title);
        return { saved: true, activityId: result.value.activityId };
      },
      () => refused(undefined),
    );
    const forget =
      permanent || silent
        ? nothing
        : showUndo(
            title,
            () => {
              undone = true;
              onUndo?.();
              unsaved.forEach((key) => drafts.rewrite(key, revert));
              void undo(sent.then(({ activityId }) => activityId), revert, onUndone);
            },
            slot,
          );
    return sent.then(({ saved }) => saved);
  };
};

export type ChangeFn = ReturnType<typeof createChange>;

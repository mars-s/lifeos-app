"use client";

import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult, type Atom } from "effect/reactivity";
import type { Id } from "@lifeos/backend/dataModel";
import {
  faceAtom,
  selectedCountAtom,
  toggleSelectedAtom,
  type renameTaskAtom,
} from "@lifeos/backend/effect/patterns/atoms";

export const SelectionCount = () => {
  const count = useAtomValue(selectedCountAtom);
  return <output>{count} selected</output>;
};

export const FaceSwitch = () => {
  const [face, setFace] = useAtom(faceAtom);
  return (
    <button type="button" aria-pressed={face === "timeline"} onClick={() => setFace(face === "list" ? "timeline" : "list")}>
      {face === "list" ? "List" : "Timeline"}
    </button>
  );
};

export const SelectRow = ({ taskKey, title }: { taskKey: string; title: string }) => {
  const selected = useAtomValue(toggleSelectedAtom, (keys) => keys.has(taskKey));
  const toggle = useAtomSet(toggleSelectedAtom);
  return (
    <button type="button" aria-pressed={selected} onClick={() => toggle(taskKey)}>
      {title}
    </button>
  );
};

type Rename = ReturnType<typeof renameTaskAtom>;

const refusalText = (state: Atom.Type<Rename>) =>
  AsyncResult.isFailure(state) ? "That did not save" : AsyncResult.isSuccess(state) ? "Saved" : "";

export const RenameButton = ({ rename, taskId, title }: { rename: Rename; taskId: Id<"tasks">; title: string }) => {
  const state = useAtomValue(rename);
  const send = useAtomSet(rename);
  return (
    <button type="button" disabled={state.waiting} onClick={() => send({ taskId, title })}>
      Rename <span role="status">{refusalText(state)}</span>
    </button>
  );
};

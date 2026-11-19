import { toast } from "@/components/ui/toast-stack";

type UndoEntry = { id: string; toastId: string; undo: () => void };

const UNDO_WINDOW_MS = 5000;
let stack: UndoEntry[] = [];
let count = 0;

const take = (id: string) => {
  const entry = stack.find((candidate) => candidate.id === id);
  stack = stack.filter((candidate) => candidate.id !== id);
  return entry;
};

const drop = (id: string) => {
  const entry = take(id);
  if (entry && !stack.some((other) => other.toastId === entry.toastId)) toast.dismiss(entry.toastId);
  return entry;
};

export const showUndo = (title: string, undo: () => void, slot?: string) => {
  count += 1;
  const id = `undo-${count}`;
  const toastId = slot ?? id;
  stack = [...stack, { id, toastId, undo }];
  setTimeout(() => take(id), UNDO_WINDOW_MS);
  toast(title, { id: toastId, duration: UNDO_WINDOW_MS, action: { label: "Undo", onClick: () => take(id)?.undo() } });
  return () => void drop(id);
};

export const canUndo = () => stack.length > 0;

export const undoLast = () => {
  const latest = stack.at(-1);
  if (!latest) return false;
  drop(latest.id)?.undo();
  return true;
};

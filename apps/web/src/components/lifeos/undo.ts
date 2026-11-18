import { toast } from "@/components/ui/toast-stack";

type UndoEntry = { id: string; undo: () => void };

const UNDO_WINDOW_MS = 5000;
let stack: UndoEntry[] = [];

const take = (id: string) => {
  const entry = stack.find((candidate) => candidate.id === id);
  stack = stack.filter((candidate) => candidate.id !== id);
  return entry;
};

export const showUndo = (title: string, undo: () => void) => {
  const id = `undo-${Date.now()}-${stack.length}`;
  stack = [...stack, { id, undo }];
  setTimeout(() => take(id), UNDO_WINDOW_MS);
  toast(title, { id, duration: UNDO_WINDOW_MS, action: { label: "Undo", onClick: () => take(id)?.undo() } });
};

export const undoLast = () => {
  const latest = stack.at(-1);
  if (!latest) return false;
  take(latest.id)?.undo();
  toast.dismiss(latest.id);
  return true;
};

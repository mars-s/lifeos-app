export type UndoToasts = {
  show: (
    title: string,
    options: { id: string; duration: number; action: { label: string; onClick: () => void }; onClose: () => void },
  ) => void;
  dismiss: (id: string) => void;
};

type UndoEntry = { id: string; toastId: string; undo: () => void };

const UNDO_WINDOW_MS = 5000;

export const createUndoStack = (toasts: UndoToasts) => {
  let stack: UndoEntry[] = [];
  let count = 0;

  const take = (id: string) => {
    const entry = stack.find((candidate) => candidate.id === id);
    stack = stack.filter((candidate) => candidate.id !== id);
    return entry;
  };

  const drop = (id: string) => {
    const entry = take(id);
    if (entry && !stack.some((other) => other.toastId === entry.toastId)) toasts.dismiss(entry.toastId);
    return entry;
  };

  return {
    showUndo: (title: string, undo: () => void, slot?: string) => {
      count += 1;
      const id = `undo-${count}`;
      const toastId = slot ?? id;
      stack = [...stack, { id, toastId, undo }];
      toasts.show(title, {
        id: toastId,
        duration: UNDO_WINDOW_MS,
        action: { label: "Undo", onClick: () => take(id)?.undo() },
        onClose: () => {
          stack = stack.filter((entry) => entry.toastId !== toastId);
        },
      });
      return () => void drop(id);
    },

    canUndo: () => stack.length > 0,

    undoLast: () => {
      const latest = stack.at(-1);
      if (!latest) return false;
      drop(latest.id)?.undo();
      return true;
    },
  };
};

export type UndoStack = ReturnType<typeof createUndoStack>;

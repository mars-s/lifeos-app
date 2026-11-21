import { createChange, noDrafts } from "@lifeos/backend/client/change";
import { createUndoStack } from "@lifeos/backend/client/undo-stack";
import { toast } from "@/components/ui/toast";
import { convex } from "@/lib/convex";
import { haptic } from "@/lib/haptics";

const CLOSE_SLACK_MS = 400;
const closing = new Map<string, ReturnType<typeof setTimeout>>();

const forget = (id: string) => {
  clearTimeout(closing.get(id));
  closing.delete(id);
};

export const undo = createUndoStack({
  show: (title, { id, duration, action, onClose }) => {
    forget(id);
    closing.set(id, setTimeout(onClose, duration + CLOSE_SLACK_MS));
    toast(title, { id, duration, icon: false, action: { label: action.label, onPress: action.onClick } });
  },
  dismiss: (id) => {
    forget(id);
    toast.dismiss(id);
  },
});

const OFFLINE = { ok: false, error: { kind: "not_connected" } } as const;

export const change = createChange({
  mutate: (mutation, args, options) => (convex ? convex.mutation(mutation, args, options) : Promise.resolve(OFFLINE)),
  showUndo: undo.showUndo,
  say: (title) => void toast(title, { icon: false }),
  refuse: (title, reason) => {
    haptic("error");
    toast.error(title, { description: reason, duration: 6000 });
  },
  drafts: noDrafts,
});

export const undoLatest = () => {
  if (undo.undoLast()) haptic("toggle");
};

import { createUndoStack } from "@lifeos/backend/client/undo-stack";
import { toast } from "@/components/ui/toast-stack";

export const { showUndo, canUndo, undoLast } = createUndoStack({ show: toast, dismiss: toast.dismiss });

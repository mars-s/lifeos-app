import { useEffect, useRef, useState } from "react";

export const useDraftText = (saved: string, commit: (text: string) => void) => {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, saved, commit });
  useEffect(() => {
    latest.current = { draft, saved, commit };
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (now.draft !== null && now.draft.trim() !== now.saved.trim()) now.commit(now.draft.trim());
    },
    [],
  );
  return {
    value: draft ?? saved,
    onChangeText: setDraft,
    onFocus: () => setDraft(saved),
    onBlur: () => {
      if (draft !== null && draft.trim() !== saved.trim()) commit(draft.trim());
      setDraft(null);
    },
  };
};

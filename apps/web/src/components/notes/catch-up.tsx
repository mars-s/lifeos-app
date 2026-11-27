"use client";

import { useConvex } from "convex/react";
import { useEffect } from "react";
import { api } from "@lifeos/backend/api";
import { catchUpAll, type SyncMarks } from "@lifeos/notes/catchup";
import { editedSince, withNote } from "./library";
import { readStored, writeStored } from "./stored";
import { relayUrl, useRelayToken } from "./use-note";

const MARKS_KEY = "lifeos-notes-marks";
const ROUNDS = 10;
const RETRY_MS = [3000, 10_000, 30_000];

const readMarks = () => {
  try {
    const parsed = JSON.parse(readStored(MARKS_KEY) ?? "null") as SyncMarks | null;
    return parsed && typeof parsed.core === "number" && typeof parsed.local === "number" ? parsed : { core: 0, local: 0 };
  } catch {
    return { core: 0, local: 0 };
  }
};

let running: Promise<void> | null = null;

export const NotesCatchUp = () => {
  const convex = useConvex();
  const token = useRelayToken();
  useEffect(() => {
    if (!token) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const run = () => {
      running ??= (async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const result = await catchUpAll({
            marks: readMarks(),
            changedInCore: (since) => convex.query(api.notes.notes.changedSince, { since }),
            editedHere: editedSince,
            withDoc: withNote,
            token,
            relayUrl,
          });
          writeStored(MARKS_KEY, JSON.stringify(result.marks));
          if (result.failed.length > 0) throw new Error("some notes did not catch up");
          attempt = 0;
          if (!result.more) break;
        }
      })()
        .catch(() => {
          const wait = RETRY_MS[attempt++];
          if (wait !== undefined && !retry) retry = setTimeout(() => {
            retry = null;
            run();
          }, wait);
        })
        .finally(() => {
          running = null;
        });
    };
    run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (retry) clearTimeout(retry);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [convex, token]);
  return null;
};

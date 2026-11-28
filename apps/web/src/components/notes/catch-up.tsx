"use client";

import { useConvex } from "convex/react";
import { Schema } from "effect";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";
import { api } from "@lifeos/backend/api";
import { catchUpAll } from "@lifeos/notes/catchup";
import { editedSince, withNote } from "./library";
import { registry } from "../../lib/atoms";
import { atomRuntime } from "../../lib/runtime";
import { relayUrl, useRelayToken } from "./use-note";

const MARKS_KEY = "lifeos-notes-marks";
const ROUNDS = 10;
const RETRY_MS = [3000, 10_000, 30_000];

const marksAtom = Atom.kvs({
  runtime: atomRuntime,
  key: MARKS_KEY,
  schema: Schema.Struct({ core: Schema.Number, local: Schema.Number }),
  defaultValue: () => ({ core: 0, local: 0 }),
}).pipe(Atom.keepAlive);

const readMarks = () => registry.get(marksAtom);

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
          registry.set(marksAtom, result.marks);
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

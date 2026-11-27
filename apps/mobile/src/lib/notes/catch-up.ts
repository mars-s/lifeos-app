import { useAuthToken } from "@convex-dev/auth/react";
import { addNetworkStateListener } from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import { api } from "@lifeos/backend/api";
import { RELAY_URL } from "@lifeos/notes/client";
import { catchUpAll } from "@lifeos/notes/catchup";
import { convex } from "@/lib/convex";
import { editedSince, readMarks, saveMarks, startLibrary, withNote } from "./library";

const relayUrl = process.env.EXPO_PUBLIC_NOTES_RELAY_URL || RELAY_URL;
const ROUNDS = 10;
const RETRY_MS = [3000, 10_000, 30_000];

let running: Promise<void> | null = null;

export const useNotesCatchUp = () => {
  const token = useAuthToken();
  useEffect(() => {
    const client = convex;
    if (!token || !client) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const run = () => {
      running ??= (async () => {
        await startLibrary();
        for (let round = 0; round < ROUNDS; round++) {
          const result = await catchUpAll({
            marks: readMarks(),
            changedInCore: (since) => client.query(api.notes.notes.changedSince, { since }),
            editedHere: editedSince,
            withDoc: withNote,
            token,
            relayUrl,
          });
          saveMarks(result.marks);
          if (result.failed.length > 0) throw new Error("some notes did not catch up");
          attempt = 0;
          if (!result.more) break;
        }
      })()
        .catch(() => {
          const wait = RETRY_MS[attempt++];
          if (wait !== undefined && !retry)
            retry = setTimeout(() => {
              retry = null;
              run();
            }, wait);
        })
        .finally(() => {
          running = null;
        });
    };
    run();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    const network = addNetworkStateListener((state) => {
      if (state.isConnected) run();
    });
    return () => {
      if (retry) clearTimeout(retry);
      appState.remove();
      network.remove();
    };
  }, [token]);
};

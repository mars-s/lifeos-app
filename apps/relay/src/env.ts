import type { Note } from "./note.ts";

export type Env = {
  readonly NOTE: DurableObjectNamespace<Note>;
  readonly CONVEX_CLOUD_URL: string;
};

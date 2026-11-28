import { toast } from "@/components/ui/toast-stack";
import { haptic } from "@/lib/haptics";
import type { UiNode } from "@lifeos/backend/client/genui";
import { readCsv, type GuHost, type GuRow, type GuValue, type GuView } from "./runtime.js";
import { frameStill, READS, SAID, SOCKETS } from "./sample";

export type Listener = Pick<GuView, "setTable" | "setValue">;

const READ_MS = 520;
const CALL_MS = 320;
const TICK_MS = 1000;

export const createWorld = (sockets: readonly string[], slow: boolean, turn: number) => {
  const tables: Record<string, GuRow[]> = Object.fromEntries(sockets.flatMap((name) => (SOCKETS[name] ? [[name, SOCKETS[name]()]] : [])));
  const values: Record<string, GuValue> = {};
  const sources = new Map<string, string>();
  const waiting = new Set<string>();
  const listeners = new Set<Listener>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let running = true;

  const later = (run: () => void, wait: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, wait);
    timers.add(timer);
  };
  const setTable = (name: string, rows: GuRow[]) => {
    tables[name] = rows;
    listeners.forEach((listener) => listener.setTable(name, rows));
  };
  const patch = (from: string, change: (row: GuRow) => GuRow) => {
    for (const [name, source] of sources) if (source === from && tables[name]) setTable(name, tables[name].map(change));
  };

  const beat = () => {
    patch("get_focus", (row) => (row.running === "yes" && Number(row.elapsed) < Number(row.minutes) ? { ...row, elapsed: Number(row.elapsed) + 1 } : row));
    const frames = tables.frames?.[0];
    if (running && frames && Number(frames.done) < Number(frames.total)) {
      const done = Number(frames.done) + 1;
      setTable("frames", [{ ...frames, done, eta: Math.max(1, Math.round((Number(frames.total) - done) / 19)), last: done % 4 === 0 ? frameStill(done) : (frames.last ?? "") }]);
    }
  };

  const host: GuHost = {
    tables,
    values,
    waiting,
    haptic,
    read: (name, from) => {
      if (sources.get(name) === from) return;
      sources.set(name, from);
      waiting.add(name);
      later(() => setTable(name, READS[from]?.() ?? []), slow ? READ_MS * 5 : READ_MS);
    },
    out: (name, value) => {
      values[name] = value;
      listeners.forEach((listener) => listener.setValue(name, value));
    },
    call: (tool, args) =>
      new Promise((resolve) => {
        later(() => {
          if (tool === "start_focus") patch("get_focus", (row) => ({ ...row, running: "yes", elapsed: 0, minutes: Number(args.minutes) || Number(row.minutes) }));
          if (tool === "stop_focus") patch("get_focus", (row) => ({ ...row, running: "no" }));
          if (tool === "stop_run") running = false;
          if (tool === "create_task") for (const [name, source] of sources) if (source === "list_tasks" && tables[name]) setTable(name, [...tables[name], { id: `new${tables[name].length}`, title: String(args.title ?? "New Task"), area: "Inbox", project: "", when: "", estimate: "", done: "no" }]);
          toast(SAID[tool] ?? `${tool} ran`, { id: `genui-${tool}` });
          resolve(true);
        }, CALL_MS);
      }),
  };

  const seen = new Map<string, string>();
  const load = (nodes: readonly UiNode[]) => {
    for (const node of nodes) {
      const { name, from } = node.attrs;
      if (name === undefined) continue;
      if (from !== undefined) host.read?.(name, from, {});
      else if (seen.get(name) !== node.text) {
        seen.set(name, node.text);
        setTable(name, readCsv(node.text));
      }
    }
  };

  return {
    turn,
    host,
    load,
    join: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      const tick = setInterval(beat, TICK_MS);
      return () => {
        clearInterval(tick);
        timers.forEach(clearTimeout);
        timers.clear();
        sources.clear();
        seen.clear();
      };
    },
  };
};

export type World = ReturnType<typeof createWorld>;

"use client";

import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { PlannerTask } from "@lifeos/backend/types";
import { isDraftTask } from "./drafts";
import { useRegisteredTask } from "./selection";

const WINDOW_ABOVE_ROWS = 50;
const FIRST_ROWS = 40;
const KEEP_PX = 400;
const REACH_PX = 640;
const DEFAULT_ROW_PX = 40;
const SCROLLER = "[data-row-scroller], #main";
const HELD = ":focus-within, :has([data-dragging], [data-state=open])";

type Row = { key: string; task: PlannerTask };

type Near = { keys: ReadonlySet<string>; heights: ReadonlyMap<string, number>; samples: ReadonlyMap<string, number> };

let revealed: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const rowSelector = (key: string) => `#main [data-task-key="${CSS.escape(key)}"]`;

export const revealRow = (key: string) => {
  if (!document.querySelector(`${rowSelector(key)}[data-row-gap]`)) return;
  flushSync(() => {
    revealed = key;
    listeners.forEach((listener) => listener());
  });
};

export const arrowTarget = (item: HTMLElement | undefined) => {
  const key = item?.dataset.rowGap === undefined ? undefined : item.dataset.taskKey;
  if (key === undefined) return item;
  revealRow(key);
  return document.querySelector<HTMLElement>(`${rowSelector(key)} [data-arrow-item]`) ?? undefined;
};

const firstAt = (rows: readonly HTMLElement[], passes: (row: HTMLElement) => boolean) => {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const row = rows[mid];
    if (row && passes(row)) high = mid;
    else low = mid + 1;
  }
  return low;
};

const scrollerOf = (list: HTMLElement) => list.closest<HTMLElement>(SCROLLER) ?? document.documentElement;

const inThisCommit = (update: () => void) => update();

const isDrawn = (row: HTMLElement) => row.dataset.rowGap === undefined;

const isSettling = (row: HTMLElement) => row.style.height !== "" && row.style.height !== "auto";

export const RowGap = memo(({ itemKey, task, height }: { itemKey: string; task: PlannerTask; height: number }) => {
  useRegisteredTask(itemKey, task);
  return <li aria-hidden="true" data-row-gap="" data-task-key={itemKey} data-task-id={task._id} style={{ height }} />;
});
RowGap.displayName = "RowGap";

export const useRowWindow = (
  list: RefObject<HTMLUListElement | null>,
  rows: readonly Row[],
  openKey: string | undefined,
  shapeOf: (task: PlannerTask) => string,
) => {
  const windowed = rows.length > WINDOW_ABOVE_ROWS;
  const [near, setNear] = useState<Near | null>(null);
  const [last, setLast] = useState<{ rows: readonly Row[]; before: ReadonlySet<string> | null }>({ rows, before: null });
  if (last.rows !== rows) setLast({ rows, before: new Set(last.rows.map((row) => row.key)) });
  const heights = useRef(new Map<string, number>());
  const samples = useRef(new Map<string, number>());
  const width = useRef(0);
  const anchor = useRef<{ key: string; top: number } | null>(null);
  const byKey = useMemo(() => new Map(rows.map((row) => [row.key, row.task])), [rows]);
  const wanted = useSyncExternalStore(
    subscribe,
    () => (revealed !== null && byKey.has(revealed) ? revealed : null),
    () => null,
  );

  const look = useEffectEvent((commit: (update: () => void) => void) => {
    const ul = list.current;
    const scroller = ul && scrollerOf(ul);
    if (!ul || !scroller || !windowed || ul.getClientRects().length === 0) return;
    const items = [...ul.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.taskKey !== undefined && byKey.has(child.dataset.taskKey),
    );
    const view = scroller.getBoundingClientRect();
    const top = Math.max(view.top, 0);
    const bottom = Math.min(view.bottom, window.innerHeight);
    const within = (reach: number) =>
      items.slice(
        firstAt(items, (row) => row.getBoundingClientRect().bottom > top - reach),
        firstAt(items, (row) => row.getBoundingClientRect().top >= bottom + reach),
      );
    const resized = ul.clientWidth !== width.current;
    if (!resized && near && within(KEEP_PX).every((row) => near.keys.has(row.dataset.taskKey ?? ""))) return;
    if (resized) {
      heights.current.clear();
      samples.current.clear();
      width.current = ul.clientWidth;
    }
    const keys = new Set(within(REACH_PX).flatMap((row) => row.dataset.taskKey ?? []));
    for (const row of items) {
      const key = row.dataset.taskKey;
      const task = key === undefined ? undefined : byKey.get(key);
      if (!key || !task || !isDrawn(row)) continue;
      if (row.matches(HELD)) keys.add(key);
      else if (row.dataset.openCard === undefined && !isSettling(row)) {
        const { height } = row.getBoundingClientRect();
        heights.current.set(key, height);
        samples.current.set(shapeOf(task), height);
      }
    }
    const held = items.find((row) => row.getBoundingClientRect().top >= top);
    anchor.current = held?.dataset.taskKey ? { key: held.dataset.taskKey, top: held.getBoundingClientRect().top } : null;
    commit(() => setNear({ keys, heights: new Map(heights.current), samples: new Map(samples.current) }));
  });

  useLayoutEffect(() => {
    if (windowed && byKey.size > 0) look(inThisCommit);
  }, [byKey, windowed]);

  useLayoutEffect(() => {
    const ul = list.current;
    const scroller = ul?.closest<HTMLElement>(SCROLLER) ?? document.documentElement;
    const held = anchor.current;
    anchor.current = null;
    if (!near || !ul || !held) return;
    const row = ul.querySelector(`:scope > [data-task-key="${CSS.escape(held.key)}"]`);
    const moved = row ? row.getBoundingClientRect().top - held.top : 0;
    if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
  }, [near, list]);

  useEffect(() => {
    const ul = list.current;
    const scroller = ul && scrollerOf(ul);
    if (!ul || !scroller || !windowed) return;
    const onChange = () => look(flushSync);
    const sizes = new ResizeObserver(onChange);
    sizes.observe(ul);
    sizes.observe(scroller);
    const scrolls = scroller === document.documentElement ? window : scroller;
    scrolls.addEventListener("scroll", onChange, { passive: true });
    return () => {
      sizes.disconnect();
      scrolls.removeEventListener("scroll", onChange);
    };
  }, [windowed, list]);

  const isNew = (key: string) => last.before !== null && !last.before.has(key);

  return {
    settled: (key: string) => windowed && !isNew(key),
    shows: (row: Row, index: number) =>
      !windowed || (near ? near.keys.has(row.key) : index < FIRST_ROWS) || row.key === openKey || row.key === wanted || isDraftTask(row.task._id) || isNew(row.key),
    gapHeight: (row: Row) =>
      near?.heights.get(row.key) ?? near?.samples.get(shapeOf(row.task)) ?? near?.samples.values().next().value ?? DEFAULT_ROW_PX,
  };
};

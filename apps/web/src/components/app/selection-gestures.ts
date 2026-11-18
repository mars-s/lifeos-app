"use client";

import { useEffect, type RefObject } from "react";
import { haptic } from "@/lib/haptics";
import { rowKeys, selection } from "./selection";

const DRAG_START_PX = 6;
const EDGE_PX = 48;
const MAX_SCROLL_PX = 18;
const NOT_A_ROW_PART = "input, textarea, select, [contenteditable=true], a, button:not([data-arrow-item]), [data-open-card], [data-no-select]";
const LASSO_CLASS = "pointer-events-none absolute z-20 rounded-md border border-brand/45 bg-brand/10";

type Drag = {
  startX: number;
  startY: number;
  fromRow: boolean;
  additive: boolean;
  base: readonly string[];
  active: boolean;
  lasso: HTMLDivElement | null;
  pointerX: number;
  pointerY: number;
  frame: number;
  hits: number;
};

const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-task-key]") : null);

const isRowPart = (target: EventTarget | null) => target instanceof Element && !target.closest(NOT_A_ROW_PART);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export const focusRow = (key: string) => {
  const row = document.querySelector<HTMLElement>(`#main [data-task-key="${CSS.escape(key)}"]`);
  const item = row?.querySelector<HTMLElement>("[data-arrow-item]");
  item?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: "nearest" });
};

export const extendSelection = (step: 1 | -1) => {
  const ordered = rowKeys();
  const from = selection.cursor();
  const index = from ? ordered.indexOf(from) : -1;
  const next = ordered[index === -1 ? (step === 1 ? 0 : ordered.length - 1) : index + step];
  if (!next) return ordered.length > 0;
  selection.extendTo(next, ordered);
  focusRow(next);
  haptic("snap");
  return true;
};

export const useSelectionGestures = (
  main: RefObject<HTMLElement | null>,
  handlers: { open: (key: string) => void; cardIsOpen: () => boolean },
) => {
  useEffect(() => {
    const surface = main.current;
    if (!surface) return;
    let drag: Drag | null = null;
    let swallowClick = false;

    const toContent = (clientX: number, clientY: number) => {
      const box = surface.getBoundingClientRect();
      return { x: clientX - box.left + surface.scrollLeft, y: clientY - box.top + surface.scrollTop };
    };

    const sweep = (state: Drag) => {
      const to = toContent(state.pointerX, state.pointerY);
      const left = Math.min(state.startX, to.x);
      const right = Math.max(state.startX, to.x);
      const top = Math.min(state.startY, to.y);
      const bottom = Math.max(state.startY, to.y);
      if (state.lasso) {
        state.lasso.style.left = `${left}px`;
        state.lasso.style.top = `${top}px`;
        state.lasso.style.width = `${right - left}px`;
        state.lasso.style.height = `${bottom - top}px`;
      }
      const box = surface.getBoundingClientRect();
      const hits = [...surface.querySelectorAll<HTMLElement>("[data-task-key]")].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        const rowTop = rect.top - box.top + surface.scrollTop;
        const rowLeft = rect.left - box.left + surface.scrollLeft;
        const crossesY = rowTop < bottom && rowTop + rect.height > top;
        const crossesX = state.fromRow || (rowLeft < right && rowLeft + rect.width > left);
        return crossesY && crossesX && row.dataset.taskKey ? [row.dataset.taskKey] : [];
      });
      if (hits.length !== state.hits) haptic("snap");
      state.hits = hits.length;
      const keys = state.additive ? [...new Set([...state.base, ...hits])] : hits;
      selection.set(keys, hits[0] ?? state.base[0] ?? null);
    };

    const autoScroll = () => {
      if (!drag?.active) return;
      const box = surface.getBoundingClientRect();
      const above = box.top + EDGE_PX - drag.pointerY;
      const below = drag.pointerY - (box.bottom - EDGE_PX);
      const speed = above > 0 ? -Math.min(MAX_SCROLL_PX, above / 3) : below > 0 ? Math.min(MAX_SCROLL_PX, below / 3) : 0;
      if (speed !== 0) {
        surface.scrollTop += speed;
        sweep(drag);
      }
      drag.frame = requestAnimationFrame(autoScroll);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      drag.pointerX = event.clientX;
      drag.pointerY = event.clientY;
      if (!drag.active) {
        const to = toContent(event.clientX, event.clientY);
        if (Math.hypot(to.x - drag.startX, to.y - drag.startY) < DRAG_START_PX) return;
        drag.active = true;
        if (!drag.fromRow) {
          drag.lasso = document.createElement("div");
          drag.lasso.className = LASSO_CLASS;
          drag.lasso.setAttribute("aria-hidden", "true");
          surface.append(drag.lasso);
        }
        drag.frame = requestAnimationFrame(autoScroll);
      }
      event.preventDefault();
      sweep(drag);
    };

    const endDrag = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      if (!drag) return;
      cancelAnimationFrame(drag.frame);
      drag.lasso?.remove();
      drag = null;
    };

    const onPointerUp = () => {
      if (drag?.active) {
        swallowClick = true;
        setTimeout(() => (swallowClick = false), 0);
      }
      endDrag();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !isRowPart(event.target) || handlers.cardIsOpen()) return;
      if (rowOf(event.target)?.closest("[data-sortable]")) return;
      const start = toContent(event.clientX, event.clientY);
      drag = {
        startX: start.x,
        startY: start.y,
        fromRow: rowOf(event.target) !== null,
        additive: event.metaKey || event.ctrlKey || event.shiftKey,
        base: selection.keys(),
        active: false,
        lasso: null,
        pointerX: event.clientX,
        pointerY: event.clientY,
        frame: 0,
        hits: -1,
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    };

    const onClick = (event: MouseEvent) => {
      if (swallowClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.detail === 0 || !isRowPart(event.target)) return;
      const key = rowOf(event.target)?.dataset.taskKey;
      if (!key) {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) selection.clear();
        return;
      }
      const touch = (event as PointerEvent).pointerType === "touch" || (event as PointerEvent).pointerType === "pen";
      if (touch) {
        if (selection.size() > 0) {
          selection.toggle(key);
          haptic("snap");
        } else handlers.open(key);
        return;
      }
      if (event.metaKey || event.ctrlKey) selection.toggle(key);
      else if (event.shiftKey) selection.extendTo(key);
      else if (event.detail >= 2) {
        selection.only(key);
        handlers.open(key);
      } else selection.only(key);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || handlers.cardIsOpen()) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && rowKeys().length > 0) {
        event.preventDefault();
        selection.all();
        return;
      }
      if (event.key === "Escape" && selection.size() > 0) {
        event.preventDefault();
        selection.clear();
        return;
      }
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        if (extendSelection(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      }
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
      endDrag();
    };
  }, [main, handlers]);
};

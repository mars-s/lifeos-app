"use client";

import { Minus, Plus } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { IconButton } from "@/components/ui/action-button";
import { cn } from "@/lib/utils";
import { GLASS } from "../notes/parts";
import { edgeGeometry, type Card, type Edge } from "./model";

export const DOT_PAPER = "bg-[radial-gradient(circle,color-mix(in_oklab,var(--foreground)_11%,transparent)_1px,transparent_1.5px)]";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (onChange: () => void) => {
  const media = window.matchMedia(MOTION_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
export const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );

type View = { k: number; x: number; y: number };
type Point = { x: number; y: number };

const NARROW = 720;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
const SLOP = 3;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const restView = (width: number, size: { w: number; h: number }, focus: Point) => {
  const fit = width / size.w;
  const k = width >= NARROW ? Math.min(1, fit) : Math.max(fit, 0.62);
  const spare = width - size.w * k;
  return { k, x: spare >= 0 ? spare / 2 : clamp(width / 2 - focus.x * k, spare, 0), y: 0 };
};

const zoomed = (from: View, factor: number, point: Point) => {
  const k = clamp(from.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / from.k;
  return { k, x: point.x - (point.x - from.x) * ratio, y: point.y - (point.y - from.y) * ratio };
};

type Drag = { kind: "pan"; from: Point; view: View } | { kind: "card"; id: string; from: Point; origin: Point; moved: boolean };

const Wire = ({ edge, cards, pencil, live, still }: { edge: Edge; cards: Card[]; pencil: boolean; live: boolean; still: boolean }) => {
  const shape = edgeGeometry(edge, cards);
  if (!shape) return null;
  const arrow = edge.toSocket === undefined;
  const angle = (Math.atan2(-shape.end.dy, -shape.end.dx) * 180) / Math.PI;
  return (
    <g data-edge={edge.id} data-ink={pencil ? "pencil" : "ink"} className="animate-fade-in">
      <path d={shape.path} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeDasharray={pencil ? "2 5" : undefined} className={pencil ? "stroke-foreground/35" : "stroke-foreground/30"} />
      {live && (
        <path d={shape.path} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeDasharray="1 11" className="stroke-foreground">
          {!still && <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.9s" repeatCount="indefinite" />}
        </path>
      )}
      {arrow && <path d="M-7,-3.5 L0,0 L-7,3.5" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="stroke-foreground/45" transform={`translate(${shape.end.x} ${shape.end.y}) rotate(${angle})`} />}
      {edge.label && (
        <text x={shape.mid.x} y={shape.mid.y} dy="0.32em" textAnchor="middle" className="fill-muted-foreground stroke-background text-[11px] font-medium [paint-order:stroke] [stroke-linejoin:round] [stroke-width:8px]">
          {edge.label}
        </text>
      )}
    </g>
  );
};

export const Stage = ({
  label,
  size,
  cards,
  edges,
  pencil,
  live,
  focus,
  movable = false,
  className,
  overlay,
  children,
}: {
  label: string;
  size: { w: number; h: number };
  cards: Card[];
  edges: Edge[];
  pencil?: ReadonlySet<string>;
  live?: ReadonlySet<string>;
  focus?: Point;
  movable?: boolean;
  className?: string;
  overlay?: ReactNode;
  children: (card: Card) => ReactNode;
}) => {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(1320);
  const [view, setView] = useState<View | null>(null);
  const [moved, setMoved] = useState<Record<string, Point>>({});
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const still = useReducedMotion();

  const rest = restView(width, size, focus ?? { x: size.w / 2, y: size.h / 2 });
  const current = view ?? rest;
  const height = width >= NARROW ? size.h * rest.k : Math.min(size.h * rest.k, 560);
  const placed = cards.map((card) => ({ ...card, ...moved[card.id] }));

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const zoomAt = (factor: number, point: Point) => setView((before) => zoomed(before ?? rest, factor, point));

  const { k: restK, x: restX } = rest;
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      setView((before) => zoomed(before ?? { k: restK, x: restX, y: 0 }, Math.exp(-event.deltaY * 0.01), point));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [restK, restX]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest("button, a, input, iframe, [data-still]")) return;
    const cardNode = movable ? event.target.closest<HTMLElement>("[data-card]") : null;
    const from = { x: event.clientX, y: event.clientY };
    const id = cardNode?.dataset.card;
    const card = placed.find((item) => item.id === id);
    drag.current = card ? { kind: "card", id: card.id, from, origin: { x: card.x, y: card.y }, moved: false } : { kind: "pan", from, view: current };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (card) setGrabbed(card.id);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active) return;
    const dx = event.clientX - active.from.x;
    const dy = event.clientY - active.from.y;
    if (active.kind === "pan") {
      setView({ k: active.view.k, x: active.view.x + dx, y: active.view.y + dy });
      return;
    }
    if (!active.moved && Math.hypot(dx, dy) < SLOP) return;
    active.moved = true;
    setMoved((before) => ({ ...before, [active.id]: { x: active.origin.x + dx / current.k, y: active.origin.y + dy / current.k } }));
  };

  const onPointerUp = () => {
    drag.current = null;
    setGrabbed(null);
  };

  const centre = { x: width / 2, y: height / 2 };

  return (
    <div
      ref={frame}
      role="group"
      aria-label={label}
      data-stage
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn("relative w-full touch-pan-y overflow-hidden rounded-2xl bg-background select-none", DOT_PAPER, className)}
      style={{ height, backgroundSize: `${16 * current.k}px ${16 * current.k}px`, backgroundPosition: `${current.x}px ${current.y}px` }}
    >
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `translate(${current.x}px, ${current.y}px) scale(${current.k})` }}>
        <svg aria-hidden="true" width={size.w} height={size.h} className="pointer-events-none absolute inset-0 overflow-visible">
          {edges.map((edge) => (
            <Wire key={edge.id} edge={edge} cards={placed} pencil={pencil?.has(edge.id) ?? false} live={live?.has(edge.id) ?? false} still={still} />
          ))}
        </svg>
        {placed.map((card) => (
          <div
            key={card.id}
            data-card={card.id}
            data-grabbed={grabbed === card.id || undefined}
            className={cn(
              "absolute",
              card.kind === "group" ? "z-0" : "z-10",
              movable && card.kind !== "group" && "cursor-grab transition-[scale,box-shadow] duration-(--dur-fast) ease-out data-grabbed:z-20 data-grabbed:scale-[1.015] data-grabbed:cursor-grabbing",
            )}
            style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
          >
            {children(card)}
          </div>
        ))}
      </div>
      <div data-still className={cn("absolute right-3 bottom-3 z-30 flex items-center rounded-full p-0.5", GLASS)}>
        <IconButton icon={Minus} iconWeight="bold" label="Zoom out" size="sm" onClick={() => zoomAt(0.8, centre)} />
        <button
          type="button"
          aria-label={`Zoom ${Math.round(current.k * 100)}%. Fit the canvas`}
          onClick={() => setView(null)}
          className="h-8 min-w-11 rounded-full px-1 font-mono text-micro text-muted-foreground tabular-nums transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.97]"
        >
          {Math.round(current.k * 100)}%
        </button>
        <IconButton icon={Plus} iconWeight="bold" label="Zoom in" size="sm" onClick={() => zoomAt(1.25, centre)} />
      </div>
      {overlay}
    </div>
  );
};

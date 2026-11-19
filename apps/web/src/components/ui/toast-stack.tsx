"use client";

import { CheckCircle, CircleNotch, Info, WarningCircle, X } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { haptic } from "@/lib/haptics";
import { CSS_EASE_OUT } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";

export type ToastTone = "default" | "success" | "error" | "loading";

export type ToastData = {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms before it closes on its own; loading toasts wait to be updated. */
  duration: number;
  dismissing?: boolean;
  /** Bumped on every update, so an updated toast restarts its countdown. */
  revision?: number;
  /** Runs once when the toast starts to leave, however it was closed. */
  onClose?: () => void;
};

type ToastOptions = Partial<Omit<ToastData, "title" | "tone" | "dismissing" | "revision">>;

// One module-level store, so `toast()` works from anywhere without context.
let toasts: ToastData[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const EMPTY: ToastData[] = [];
let counter = 0;

function upsert(title: React.ReactNode, tone: ToastTone, options: ToastOptions = {}) {
  const id = options.id ?? `toast-${++counter}`;
  const next: ToastData = { duration: 4000, ...options, id, title, tone, revision: ++counter };
  if (tone === "error") haptic("error");
  toasts = toasts.some((t) => t.id === id)
    ? toasts.map((t) => (t.id === id ? { ...t, ...next, dismissing: false } : t))
    : [next, ...toasts];
  emit();
  return id;
}

function dismiss(id: string) {
  toasts.find((t) => t.id === id && !t.dismissing)?.onClose?.();
  toasts = toasts.map((t) => (t.id === id ? { ...t, dismissing: true } : t));
  emit();
  // Remove after the exit transition.
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 200);
}

/** Shows a toast. Pass `id` to update an existing one in place. */
export const toast = Object.assign(
  (title: React.ReactNode, options?: ToastOptions) => upsert(title, "default", options),
  {
    success: (title: React.ReactNode, options?: ToastOptions) =>
      upsert(title, "success", options),
    error: (title: React.ReactNode, options?: ToastOptions) =>
      upsert(title, "error", { duration: 6000, ...options }),
    loading: (title: React.ReactNode, options?: ToastOptions) =>
      upsert(title, "loading", { duration: Infinity, ...options }),
    /** A loading toast that turns into success or error when the promise settles. */
    promise<T>(
      promise: Promise<T>,
      messages: {
        loading: React.ReactNode;
        success: React.ReactNode;
        error: React.ReactNode;
      },
    ) {
      const id = upsert(messages.loading, "loading", { duration: Infinity });
      promise.then(
        () => upsert(messages.success, "success", { id, duration: 4000 }),
        () => upsert(messages.error, "error", { id, duration: 6000 }),
      );
      return promise;
    },
    dismiss,
  },
);

const tones: Record<ToastTone, { icon: typeof Info; className: string }> = {
  default: { icon: Info, className: "text-muted-foreground" },
  success: { icon: CheckCircle, className: "text-positive" },
  error: { icon: WarningCircle, className: "text-negative" },
  loading: {
    icon: CircleNotch,
    className: "animate-spin text-brand motion-reduce:animate-none",
  },
};

const GAP = 8;

const OVERLAYS = "[data-radix-popper-content-wrapper] > *, [data-covers-toasts]";

const within = (home: DOMRect, overlay: DOMRect) =>
  home.left - GAP < overlay.right &&
  overlay.left < home.right + GAP &&
  home.top - GAP < overlay.bottom &&
  overlay.top < home.bottom + GAP;

export type ToasterProps = {
  /** Toasts visible in the collapsed stack; older ones wait behind. */
  visible?: number;
  position?: "bottom-right" | "bottom-center";
  className?: string;
};

/** Mount once near the root. Toasts stack, fan out on hover and pause while you read. */
export function Toaster({
  visible = 3,
  position = "bottom-right",
  className,
}: ToasterProps) {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => EMPTY,
  );
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [covered, setCovered] = useState(false);
  const stack = useRef<HTMLOListElement>(null);

  // Timers pause while the tab is in the background.
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const live = items.filter((t) => !t.dismissing);
  const frontHeight = heights[live[0]?.id ?? ""] ?? 0;
  const watching = live.length > 0;
  const away = covered && watching;
  const fanned = expanded && !away;

  useEffect(() => {
    if (!watching) return;
    let frame = requestAnimationFrame(function look() {
      const home = stack.current?.getBoundingClientRect();
      setCovered(
        !!home &&
          [...document.querySelectorAll(OVERLAYS)].some((overlay) =>
            within(home, overlay.getBoundingClientRect()),
          ),
      );
      frame = requestAnimationFrame(look);
    });
    return () => cancelAnimationFrame(frame);
  }, [watching]);

  return (
    <section
      data-toaster
      aria-label="Notifications"
      className={cn(
        "pointer-events-none fixed bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))]",
        position === "bottom-right" ? "right-4" : "left-1/2 -translate-x-1/2",
        className,
      )}
    >
      <ol
        ref={stack}
        inert={away}
        className={cn("relative", !away && "pointer-events-auto")}
        style={{ height: frontHeight }}
        onPointerEnter={() => setExpanded(true)}
        onPointerLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
        }}
      >
        {items.map((item) => {
          const index = live.indexOf(item);
          // Expanded: each toast sits above the newer ones. Collapsed: peeking behind the front one.
          const offset = live
            .slice(0, Math.max(index, 0))
            .reduce((sum, t) => sum + (heights[t.id] ?? 0) + GAP, 0);
          return (
            <ToastItem
              key={item.id}
              item={item}
              index={index}
              expanded={fanned}
              offset={offset}
              height={heights[item.id]}
              frontHeight={frontHeight}
              hiddenBehind={index >= visible}
              away={away}
              paused={fanned || hidden || away}
              onHeight={(h) =>
                setHeights((current) =>
                  current[item.id] === h ? current : { ...current, [item.id]: h },
                )
              }
            />
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {live[0]
          ? `${typeof live[0].title === "string" ? live[0].title : "Notification"}`
          : ""}
      </p>
    </section>
  );
}

function ToastItem({
  item,
  index,
  expanded,
  offset,
  height,
  frontHeight,
  hiddenBehind,
  away,
  paused,
  onHeight,
}: {
  item: ToastData;
  index: number;
  expanded: boolean;
  offset: number;
  height: number | undefined;
  frontHeight: number;
  hiddenBehind: boolean;
  away: boolean;
  paused: boolean;
  onHeight: (height: number) => void;
}) {
  const reduce = useReducedMotion();
  const content = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [drag, setDrag] = useState<{ y: number; startY: number; at: number } | null>(
    null,
  );
  const remaining = useRef(item.duration);

  // Measure for the expanded layout.
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    const observer = new ResizeObserver(() => onHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeight]);

  // Enter on the next frame so the start position gets painted first.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Reset the countdown when the toast is updated (e.g. a promise settled).
  useEffect(() => {
    remaining.current = item.duration;
  }, [item.duration, item.tone, item.revision]);

  useEffect(() => {
    if (paused || item.dismissing || !Number.isFinite(remaining.current)) return;
    const start = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - start;
    };
  }, [paused, item.dismissing, item.id, item.duration, item.tone, item.revision]);

  const front = index === 0;
  const dragY = drag?.y ?? 0;
  const y = item.dismissing
    ? 0
    : expanded
      ? -offset + dragY
      : -Math.max(index, 0) * 10 + dragY;
  const scale = expanded || item.dismissing ? 1 : 1 - Math.max(index, 0) * 0.05;
  const here = mounted && !item.dismissing && !away;
  const shown = here && !hiddenBehind;
  const tucked = !front && !expanded;
  const { icon: ToneIcon, className: toneClass } = tones[item.tone];

  return (
    <li
      aria-live={item.tone === "error" ? "assertive" : "polite"}
      className="absolute inset-x-0 bottom-0 touch-none select-none"
      style={{
        zIndex: index < 0 ? 0 : 100 - index,
        opacity: shown ? 1 : 0,
        transform: `translateY(${shown || item.dismissing ? y : 0}px) translateY(${here || reduce ? "0%" : "100%"}) scale(${scale})`,
        transformOrigin: "50% 100%",
        transition: drag
          ? "none"
          : `${reduce ? "" : `transform 400ms ${CSS_EASE_OUT}, `}opacity ${here ? 250 : 150}ms ${CSS_EASE_OUT}`,
        pointerEvents: hiddenBehind ? "none" : undefined,
      }}
      onPointerDown={(event) => {
        if (!front && !expanded) return;
        if ((event.target as HTMLElement).closest("button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ y: 0, startY: event.clientY, at: Date.now() });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const delta = event.clientY - drag.startY;
        // Downward follows the finger; upward meets friction.
        setDrag({ ...drag, y: delta > 0 ? delta : delta * 0.15 });
      }}
      onPointerUp={() => {
        if (!drag) return;
        const velocity = Math.abs(drag.y) / Math.max(Date.now() - drag.at, 1);
        setDrag(null);
        if (drag.y > 45 || (drag.y > 0 && velocity > 0.11)) dismiss(item.id);
      }}
    >
      <div
        className="group overflow-hidden rounded-2xl bg-popover text-foreground shadow-float"
        style={{
          height: tucked ? frontHeight : height,
          transition: reduce ? undefined : `height 400ms ${CSS_EASE_OUT}`,
        }}
      >
        <div
          ref={content}
          className={cn("flex items-start gap-3 p-3", tucked && "[&>*]:opacity-0")}
        >
          <ToneIcon
            weight={item.tone === "loading" ? "bold" : "fill"}
            aria-hidden="true"
            className={cn("mt-0.5 size-4 shrink-0", toneClass)}
          />
          <div className="min-w-0 flex-1 transition-opacity duration-150">
            <p
              key={typeof item.title === "string" ? item.title : undefined}
              className="animate-fade-in text-sm font-medium text-balance wrap-anywhere motion-reduce:animate-none"
            >
              {item.title}
            </p>
            {item.description && (
              <p className="mt-0.5 text-[0.8125rem] text-pretty wrap-anywhere text-muted-foreground">
                {item.description}
              </p>
            )}
          </div>
          {item.action && (
            <Button
              size="sm"
              className="-my-1 h-7 px-3"
              onClick={() => {
                item.action?.onClick();
                dismiss(item.id);
              }}
            >
              {item.action.label}
            </Button>
          )}
          <IconButton
            icon={X}
            iconWeight="bold"
            label="Dismiss"
            className="-my-1.5 -mr-1.5 size-7 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={() => dismiss(item.id)}
          />
        </div>
      </div>
    </li>
  );
}

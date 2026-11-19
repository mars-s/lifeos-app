"use client";

import { List as MenuIcon } from "@phosphor-icons/react";
import { addTransitionType, startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "waku";
import { api } from "@lifeos/backend/api";
import type { IsoDate } from "@lifeos/backend/date";
import { isConvexConfigured } from "@/components/convex-client-provider";
import { EmptyState } from "@/components/lifeos/states";
import { undoLast } from "@/components/lifeos/undo";
import { Toaster } from "@/components/ui/toast-stack";
import { cn } from "@/lib/utils";
import { CommandBarHost } from "./command-bar/host";
import { ConfirmHost } from "./confirm";
import { drafts } from "./drafts";
import { FocusPill, FocusProvider } from "./focus";
import { FocusSignals } from "./focus-signals";
import { useLocalDate, useQuietView, useViewState, valueOf } from "./hooks";
import { AppMenu } from "./menus";
import { PanelBoundary, PanelNotice } from "./panel-boundary";
import { LISTS, parseRoute, routeHref, screenKey, type Route, type Via } from "./route";
import { UPCOMING_DAYS } from "./dates";
import { Screen } from "./screens";
import { SelectionBar } from "./selection-bar";
import { Onboarding } from "./settings/onboarding";
import { useSelectionGestures } from "./selection-gestures";
import { ShellContext, liveShell, type Depth, type ListDraft, type OpenCard, type Renaming, type ShellState } from "./shell-context";
import { Sidebar } from "./sidebar";
import { WindowDragStrip } from "./window-drag-strip";

const PLANNER_KEY = "8";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const moveFocus = (step: 1 | -1, main: HTMLElement | null) => {
  const active = document.activeElement;
  const scope = (active instanceof HTMLElement && active.closest<HTMLElement>("[data-arrow-scope]")) || main;
  if (!scope) return false;
  const items = [...scope.querySelectorAll<HTMLElement>("[data-arrow-item]")];
  const current = active instanceof HTMLElement ? items.indexOf(active) : -1;
  const next = items[current === -1 ? (step === 1 ? 0 : items.length - 1) : current + step];
  if (!next) return items.length > 0;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest" });
  return true;
};

const WarmLists = ({ today }: { today: IsoDate }) => {
  useQuietView(api.planner.lists.inbox, {});
  useQuietView(api.planner.today.get, { date: today });
  useQuietView(api.planner.lists.upcoming, { date: today, days: UPCOMING_DAYS });
  useQuietView(api.planner.lists.anytime, { date: today });
  useQuietView(api.planner.lists.someday, {});
  useQuietView(api.planner.labels.list, {});
  useQuietView(api.planner.templates.list, {});
  return null;
};

const Connected = ({ today, children }: { today: IsoDate; children: ReactNode }) => {
  const router = useRouter();
  const actual = `${router.path}${router.query ? `?${router.query.replace(/^\?/, "")}` : ""}`;
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [via, setVia] = useState<Via>("keyboard");
  const [card, setCard] = useState<(OpenCard & { href: string }) | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [draft, setDraft] = useState<ListDraft | null>(null);
  const latest = useRef<ShellState | null>(null);
  const main = useRef<HTMLElement>(null);
  const aside = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const hadDrawer = useRef(false);
  if (pending && pending.from !== actual) setPending(null);
  const href = pending?.from === actual ? pending.to : actual;
  const route = useMemo(() => parseRoute(href), [href]);
  const [sidebarAttempt, setSidebarAttempt] = useState(0);
  const sidebarState = useViewState(api.planner.sidebar.get, { date: today });
  const sidebar = valueOf(sidebarState.value);

  const shell = useMemo(() => {
    const navigate = (to: Route, how: Via, depth?: Depth) => {
      const target = routeHref(to);
      setDrawer(false);
      setVia(how);
      if (target === href) return;
      const go = () => {
        setPending({ from: actual, to: target });
        main.current?.scrollTo({ top: 0 });
        router.push(target as never).catch(() => setPending(null));
      };
      if (!depth || how === "keyboard") return go();
      startTransition(() => {
        addTransitionType(depth);
        go();
      });
    };
    return {
      route,
      via,
      today,
      navigate,
      openCard: card?.href === href ? card : null,
      setOpenCard: (next, on) => setCard(next && { ...next, href: on ? routeHref(on) : href }),
      closeCard: (key) => setCard((open) => (open?.key === key ? null : open)),
      renaming,
      setRenaming,
      draft,
      setDraft: (next) => {
        if (next) setDrawer(true);
        setDraft(next);
      },
    } satisfies ShellState;
  }, [route, via, today, card, href, actual, router, renaming, draft]);

  useEffect(() => {
    latest.current = shell;
    liveShell.current = shell;
  }, [shell]);
  const openKey = card?.href === href ? card.key : undefined;
  useEffect(() => drafts.keepOnly(openKey), [openKey]);
  const gestures = useMemo(
    () => ({
      open: (key: string) => latest.current?.setOpenCard({ key, instant: false }),
      cardIsOpen: () => latest.current?.openCard != null,
    }),
    [],
  );
  useSelectionGestures(main, gestures);

  useEffect(() => {
    if (drawer) aside.current?.querySelector<HTMLElement>("[aria-current=page], [data-arrow-item]")?.focus({ preventScroll: true });
    else if (hadDrawer.current && aside.current?.contains(document.activeElement)) menuButton.current?.focus();
    hadDrawer.current = drawer;
  }, [drawer]);

  useEffect(() => {
    if (router.path === "/") router.replace("/today" as never).catch(() => undefined);
  }, [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const undoes = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z";
      const ownsUndo = isTyping(event.target) && (event.target as HTMLElement).dataset.undo !== "app";
      if (undoes && !event.defaultPrevented && !ownsUndo) {
        if (undoLast()) event.preventDefault();
        return;
      }
      if (event.defaultPrevented || isTyping(event.target) || event.altKey || event.ctrlKey || event.shiftKey) return;
      const list = LISTS[Number(event.key) - 1];
      if (list) {
        event.preventDefault();
        return shell.navigate({ kind: list }, "keyboard");
      }
      if (event.key === PLANNER_KEY) {
        event.preventDefault();
        return shell.navigate({ kind: "planner" }, "keyboard");
      }
      if (event.metaKey) return;
      if (event.key === "Escape") return setDrawer(false);
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
      if (step !== 0 && moveFocus(step, main.current)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shell]);

  return (
    <ShellContext value={shell}>
      <FocusProvider>
      <WarmLists today={today} />
      <PanelBoundary panel="list" fallback={() => children}>
      <AppMenu sidebar={sidebar}>
      <div className="flex h-dvh bg-surface select-none [-webkit-touch-callout:none]">
        <a
          href="#main"
          className="absolute top-2 left-2 z-[60] -translate-y-16 rounded-full bg-popover px-3 py-1.5 text-small font-medium shadow-float focus-visible:translate-y-0"
        >
          Skip to the list
        </a>
        <button
          type="button"
          aria-label="Close the sidebar"
          tabIndex={drawer ? 0 : -1}
          onClick={() => setDrawer(false)}
          className={cn(
            "fixed inset-0 z-40 bg-black/30 transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none md:hidden",
            drawer ? "opacity-100" : "pointer-events-none invisible opacity-0",
          )}
        />
        <aside
          ref={aside}
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-[17rem] bg-surface transition-[translate,visibility,box-shadow] duration-300 ease-drawer motion-reduce:transition-none md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0 md:shadow-none lg:w-64",
            drawer ? "translate-x-0 shadow-float" : "max-md:invisible max-md:-translate-x-full",
          )}
        >
          <PanelBoundary key={sidebarAttempt} panel="sidebar">
            <Sidebar
              view={sidebar}
              via={via}
              notice={
                sidebarState.error && !sidebar ? (
                  <PanelNotice panel="sidebar" variant="panel" onRetry={() => setSidebarAttempt((attempt) => attempt + 1)} />
                ) : undefined
              }
            />
          </PanelBoundary>
        </aside>
        <div inert={drawer} className="flex min-w-0 flex-1 flex-col md:py-1.5 md:pr-1.5">
          <main
            id="main"
            ref={main}
            tabIndex={-1}
            className="relative min-h-0 flex-1 scroll-pt-14 overflow-y-auto overscroll-contain bg-surface-inset outline-none md:scroll-pt-2 md:rounded-2xl"
          >
            <div className="sticky top-0 z-10 flex h-12 items-center bg-surface-inset/85 px-2 backdrop-blur-md md:hidden">
              <button
                type="button"
                aria-label="Open the sidebar"
                ref={menuButton}
                aria-expanded={drawer}
                onClick={() => setDrawer(true)}
                className="grid size-10 place-items-center rounded-full text-muted-foreground transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] active:scale-[0.94]"
              >
                <MenuIcon weight="bold" className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div key={screenKey(route)} className={cn(via === "pointer" && "animate-screen-in")}>
              <PanelBoundary panel="list" variant="screen">
                <Screen route={route} sidebar={sidebar} sidebarFailed={sidebarState.error !== null} />
              </PanelBoundary>
            </div>
            {children}
          </main>
          <PanelBoundary panel="bar" fallback={() => null}>
            <SelectionBar />
          </PanelBoundary>
          <PanelBoundary panel="bar" fallback={() => null}>
            <FocusPill />
            <FocusSignals />
          </PanelBoundary>
        </div>
      </div>
      </AppMenu>
      <PanelBoundary panel="bar" fallback={() => null}>
        <CommandBarHost sidebar={sidebar} />
      </PanelBoundary>
      <PanelBoundary panel="bar" fallback={() => null}>
        <Onboarding />
      </PanelBoundary>
      </PanelBoundary>
      </FocusProvider>
    </ShellContext>
  );
};

const SetupNotice = () => (
  <div className="grid min-h-dvh place-items-center bg-surface-inset">
    <EmptyState
      title="Convex is not connected yet"
      hint="Run npx convex dev in packages/backend, then set WAKU_PUBLIC_CONVEX_URL in apps/web/.env.local."
    />
  </div>
);

export const AppShell = ({ children }: { children: ReactNode }) => {
  const today = useLocalDate();
  return (
    <>
      {!isConvexConfigured ? <SetupNotice /> : today ? <Connected today={today}>{children}</Connected> : <div className="h-dvh bg-surface" />}
      <ConfirmHost />
      <Toaster />
      <WindowDragStrip />
    </>
  );
};

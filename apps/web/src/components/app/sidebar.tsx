"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Archive, CalendarDots, CheckSquare, SignOut, Stack, Star, Tray, type Icon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { api } from "@lifeos/backend/api";
import type { SidebarView } from "@lifeos/backend/types";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { LifeosMark } from "@/components/lifeos/mark";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { MorphText } from "@/components/ui/morph-text";
import { RollingNumber } from "@/components/ui/rolling-number";
import { instant, spring } from "@/lib/motion-tokens";
import { cn } from "@/lib/utils";
import { timeAgo } from "./dates";
import { useNow, useView } from "./hooks";
import { RouteLink } from "./list-page";
import { sameRoute, type ListKind, type Route, type Via } from "./route";
import { useShell } from "./shell-context";

export const LIST_META = {
  inbox: { label: "Inbox", icon: Tray },
  today: { label: "Today", icon: Star },
  upcoming: { label: "Upcoming", icon: CalendarDots },
  anytime: { label: "Anytime", icon: Stack },
  someday: { label: "Someday", icon: Archive },
  logbook: { label: "Logbook", icon: CheckSquare },
} as const satisfies Record<ListKind, { label: string; icon: Icon }>;

const STALE_AFTER_MS = 10 * 60_000;

const NavItem = ({
  to,
  label,
  icon: IconComponent,
  leading,
  count,
  indent = false,
  quiet = false,
  via,
}: {
  to: Route;
  label: string;
  icon?: Icon;
  leading?: ReactNode;
  count?: number;
  indent?: boolean;
  quiet?: boolean;
  via: Via;
}) => {
  const { route } = useShell();
  const reduce = useReducedMotion();
  const active = sameRoute(route, to);
  return (
    <RouteLink
      to={to}
      data-arrow-item
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-lg pr-2.5 text-small outline-offset-[-2px] transition-[color,scale] duration-(--dur-press) ease-out active:scale-[0.985]",
        indent ? "pl-7" : "pl-2.5",
        active ? "font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.04]",
        quiet && !active && "text-muted-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-selection"
          transition={reduce || via === "keyboard" ? instant : spring}
          className="absolute inset-0 rounded-lg bg-foreground/[0.08]"
        />
      )}
      <span className={cn("relative grid size-4 shrink-0 place-items-center", active ? "text-brand" : "text-muted-foreground")}>
        {IconComponent ? <IconComponent weight="fill" className="size-4" aria-hidden="true" /> : leading}
      </span>
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <RollingNumber value={count} className="relative font-mono text-micro text-faint-foreground" />
      )}
    </RouteLink>
  );
};

const ProjectItem = ({ project, colour, indent, via }: { project: SidebarView["projects"][number]; colour: string; indent: boolean; via: Via }) => (
  <NavItem
    to={{ kind: "project", id: project._id }}
    label={project.title}
    indent={indent}
    quiet={project.someday}
    via={via}
    leading={
      <ProgressPie
        value={project.progress.total === 0 ? 0 : project.progress.done / project.progress.total}
        colour={colour}
        className={cn(project.someday && "opacity-50")}
      />
    }
  />
);

const SyncIndicator = () => {
  const status = useView(api.planner.things.status, {});
  const now = useNow();
  if (status === undefined || now === null || status?.retiredAt !== undefined) return <p className="h-8 flex-1" />;
  const fresh = status !== null && now - status.syncedAt < STALE_AFTER_MS;
  return (
    <p
      className="flex h-8 min-w-0 flex-1 items-center gap-2 pl-2.5 text-micro text-faint-foreground"
      title={status ? new Date(status.syncedAt).toLocaleString("en-AU") : undefined}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", fresh ? "bg-positive" : "bg-foreground/25")} />
      <MorphText>{status ? `Synced from Things ${timeAgo(status.syncedAt, Math.max(now, status.syncedAt))}` : "Not synced from Things yet"}</MorphText>
    </p>
  );
};

const SignOutButton = () => {
  const { signOut } = useAuthActions();
  return (
    <button
      type="button"
      aria-label="Sign out"
      title="Sign out"
      onClick={() => void signOut()}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-faint-foreground transition-[background-color,color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.94]"
    >
      <SignOut className="size-4" aria-hidden="true" />
    </button>
  );
};

export const Sidebar = ({ view, via }: { view: SidebarView | undefined; via: Via }) => (
  <nav aria-label="Lists" data-arrow-scope className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-2">
    <div data-tauri-drag-region className="flex h-12 shrink-0 items-end px-2.5 pb-1">
      <span className="flex items-center gap-2 text-small font-semibold md:hidden">
        <LifeosMark fill="enter" />
        LifeOS
      </span>
    </div>
    <div>
      <NavItem to={{ kind: "inbox" }} {...LIST_META.inbox} count={view?.counts.inbox} via={via} />
    </div>
    <div>
      <NavItem to={{ kind: "today" }} {...LIST_META.today} count={view?.counts.today} via={via} />
      <NavItem to={{ kind: "upcoming" }} {...LIST_META.upcoming} via={via} />
      <NavItem to={{ kind: "anytime" }} {...LIST_META.anytime} via={via} />
      <NavItem to={{ kind: "someday" }} {...LIST_META.someday} via={via} />
    </div>
    <div>
      <NavItem to={{ kind: "logbook" }} {...LIST_META.logbook} via={via} />
    </div>
    {view && view.projects.length > 0 && (
      <div>
        {view.projects.map((project) => (
          <ProjectItem key={project._id} project={project} colour="var(--muted-foreground)" indent={false} via={via} />
        ))}
      </div>
    )}
    {view?.areas.map((area) => (
      <div key={area._id}>
        <NavItem
          to={{ kind: "area", id: area._id }}
          label={area.title}
          leading={<AreaDot colour={area.colour} className="size-2.5" />}
          via={via}
        />
        {area.projects.map((project) => (
          <ProjectItem key={project._id} project={project} colour={areaVar(area.colour)} indent via={via} />
        ))}
      </div>
    ))}
    <div className="mt-auto flex items-center pt-2">
      <SyncIndicator />
      <SignOutButton />
    </div>
  </nav>
);

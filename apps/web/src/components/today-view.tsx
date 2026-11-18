"use client";

import { useQuery } from "convex/react";
import { Circle, Star } from "lucide-react";
import { useSyncExternalStore } from "react";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import { deserialise } from "@lifeos/backend/result";
import type { TodayTask } from "@lifeos/backend/types";
import { Card, CardContent } from "@/components/ui/card";
import { isConvexConfigured } from "@/components/convex-client-provider";

const greetingFor = (hour: number) =>
  hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

const subscribeNever = () => () => {};
const useClientOnly = (read: () => string) => useSyncExternalStore(subscribeNever, read, () => null);
const readLocalDate = () => localIsoDate(new Date());
const readGreeting = () => greetingFor(new Date().getHours());

const longDate = (isoDate: string) =>
  new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );

export const TodayView = () => {
  const date = useClientOnly(readLocalDate);
  const greeting = useClientOnly(readGreeting);
  return (
    <section className="mx-auto w-full max-w-xl px-6 py-16">
      <header className="mb-10">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <Star className="size-6 fill-amber-300/70 text-amber-400/80" strokeWidth={1.5} aria-hidden />
          Today
        </h1>
        <p className="mt-2 min-h-5 text-sm text-muted-foreground">
          {date && greeting && `${greeting}, Avi. ${longDate(date)}.`}
        </p>
      </header>
      {isConvexConfigured ? date && <TodayTasks date={date} /> : <SetupNotice />}
    </section>
  );
};

const TodayTasks = ({ date }: { date: string }) => {
  const response = useQuery(api.today.get, { date });
  if (response === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <>
      {deserialise(response).match(
        ({ tasks }) => (tasks.length === 0 ? <EmptyDay /> : <TaskList tasks={tasks} />),
        (error) => <p className="text-sm text-destructive">Could not read the date {error.input}.</p>,
      )}
      <SyncNote />
    </>
  );
};

const clockTime = (ms: number) =>
  new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(new Date(ms));

const SyncNote = () => {
  const status = useQuery(api.things.syncStatus);
  if (status === undefined) return null;
  return (
    <p className="mt-10 text-xs text-muted-foreground/80">
      {status ? `Synced from Things at ${clockTime(status.syncedAt)}.` : "Not synced from Things yet. Run pnpm sync:things."}
    </p>
  );
};

const TaskList = ({ tasks }: { tasks: TodayTask[] }) => (
  <ul className="divide-y divide-border/70">
    {tasks.map((task) => (
      <li key={task._id} className="flex items-center gap-3 py-3">
        <Circle className="size-[18px] shrink-0 text-muted-foreground/70" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 truncate">{task.title}</span>
        {task.context && <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">{task.context}</span>}
      </li>
    ))}
  </ul>
);

const EmptyDay = () => <p className="text-sm text-muted-foreground">Nothing in Today. Enjoy the space.</p>;

const SetupNotice = () => (
  <Card className="border-dashed shadow-none">
    <CardContent className="space-y-2 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Convex is not connected yet.</p>
      <p>
        Run <code className="rounded bg-muted px-1.5 py-0.5">npx convex dev</code> in{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">packages/backend</code>, then set{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">WAKU_PUBLIC_CONVEX_URL</code> in{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">apps/web/.env.local</code>.
      </p>
    </CardContent>
  </Card>
);

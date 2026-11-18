"use client";

import { useQuery } from "convex/react";
import { Circle, CircleCheck, Star } from "lucide-react";
import { useSyncExternalStore } from "react";
import { api } from "@lifeos/backend/api";
import { localIsoDate } from "@lifeos/backend/date";
import type { Doc } from "@lifeos/backend/dataModel";
import { deserialise } from "@lifeos/backend/result";
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
  return deserialise(response).match(
    ({ tasks }) => (tasks.length === 0 ? <EmptyDay /> : <TaskList tasks={tasks} />),
    (error) => <p className="text-sm text-destructive">Could not read the date {error.input}.</p>,
  );
};

const TaskList = ({ tasks }: { tasks: Doc<"tasks">[] }) => (
  <ul className="divide-y divide-border/70">
    {tasks.map((task) => (
      <li key={task._id} className="flex items-center gap-3 py-3">
        {task.status === "done" ? (
          <CircleCheck className="size-[18px] text-muted-foreground" strokeWidth={1.5} aria-label="Done" />
        ) : (
          <Circle className="size-[18px] text-muted-foreground/70" strokeWidth={1.5} aria-label="Open" />
        )}
        <span className={task.status === "done" ? "text-muted-foreground line-through" : ""}>{task.title}</span>
        {task.area && <span className="ml-auto text-xs text-muted-foreground">{task.area}</span>}
      </li>
    ))}
  </ul>
);

const EmptyDay = () => <p className="text-sm text-muted-foreground">Nothing planned. Enjoy the space.</p>;

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

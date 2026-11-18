"use client";

import {
  Archive,
  ArrowCounterClockwise,
  CalendarDots,
  FastForward,
  Notebook,
  PencilSimple,
  Stack,
  Star,
  Tray,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/action-button";
import { Kbd } from "@/components/ui/key-hint";
import { MorphText } from "@/components/ui/morph-text";
import { RollingNumber } from "@/components/ui/rolling-number";
import { toast } from "@/components/ui/toast-stack";
import { ActivityTimeline, type Brush } from "@/components/lifeos/activity-timeline";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { CalendarStrip } from "@/components/lifeos/calendar-strip";
import { DayColumnHeader } from "@/components/lifeos/capacity";
import { CommandPalette } from "@/components/lifeos/command-palette";
import { FocusTimerPill, useFocusSession } from "@/components/lifeos/focus-timer";
import { formatMinutes, formatRange } from "@/components/lifeos/format";
import { ProgressPie, ProgressRing } from "@/components/lifeos/progress-ring";
import { EstimateActual, FocusHeatmap, ShutdownSummary } from "@/components/lifeos/review";
import { SidebarItem } from "@/components/lifeos/sidebar-item";
import { EmptyState, ThingsStatus } from "@/components/lifeos/states";
import { TaskCard } from "@/components/lifeos/task-card";
import { TaskList } from "@/components/lifeos/task-list";
import { TaskRow } from "@/components/lifeos/task-row";
import { showUndo } from "@/components/lifeos/undo";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import {
  ACTIVITY,
  AREAS,
  CARD_TASKS,
  COMMANDS,
  COMMITMENTS,
  HEAT_HOURS,
  HEAT_MINUTES,
  HEAT_WEEKDAYS,
  BOARD_TODAY,
  LABELS,
  PLANNABLE,
  ROW_STATES,
  SHUTDOWN_AREAS,
  TODAY_TASKS,
  WEEK_TOTALS,
  WORK_BLOCK,
} from "./sample-data";
import { Specimen } from "./specimen";

const LISTS = [
  { id: "inbox", label: "Inbox", icon: Tray, count: 3 },
  { id: "today", label: "Today", icon: Star, count: 4 },
  { id: "upcoming", label: "Upcoming", icon: CalendarDots },
  { id: "anytime", label: "Anytime", icon: Stack },
  { id: "someday", label: "Someday", icon: Archive },
  { id: "logbook", label: "Logbook", icon: Notebook },
];

const PROJECTS: Record<string, { name: string; progress: number }[]> = {
  University: [{ name: "Honours thesis", progress: 0.58 }],
  Korvant: [{ name: "Launch", progress: 0.25 }],
};

const SidebarDemo = () => {
  const [active, setActive] = useState("today");
  return (
    <nav aria-label="Sidebar specimen" className="w-full max-w-60 space-y-4 rounded-2xl bg-surface p-2">
      <div>
        {LISTS.map((list) => (
          <SidebarItem
            key={list.id}
            icon={list.icon}
            label={list.label}
            count={list.count}
            active={active === list.id}
            onSelect={() => setActive(list.id)}
          />
        ))}
      </div>
      <div>
        {AREAS.slice(0, 4).map((area) => (
          <div key={area.name}>
            <SidebarItem
              leading={<AreaDot colour={area.colour} className="size-2.5" />}
              label={area.name}
              active={active === area.name}
              onSelect={() => setActive(area.name)}
            />
            {PROJECTS[area.name]?.map((project) => (
              <SidebarItem
                key={project.name}
                indent
                leading={<ProgressPie value={project.progress} colour={areaVar(area.colour)} />}
                label={project.name}
                active={active === project.name}
                onSelect={() => setActive(project.name)}
              />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
};

const RowStatesDemo = () => {
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set(["groceries"]));
  return (
    <ul className="w-full">
      {ROW_STATES.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            completed={completed.has(task.id)}
            onCompletedChange={(next) => {
              setCompleted((current) => {
                const copy = new Set(current);
                if (next) copy.add(task.id);
                else copy.delete(task.id);
                return copy;
              });
              if (next) {
                showUndo(`Completed “${task.title}”`, () =>
                  setCompleted((current) => new Set([...current].filter((id) => id !== task.id))),
                );
              }
            }}
          />
        </li>
      ))}
    </ul>
  );
};

const TaskCardDemo = () => {
  const [open, setOpen] = useState<string | null>(CARD_TASKS[0]?.id ?? null);
  return (
    <div className="w-full">
      {CARD_TASKS.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          labels={LABELS}
          today={BOARD_TODAY}
          open={open === task.id}
          onOpenChange={(next) => setOpen(next ? task.id : open === task.id ? null : open)}
        />
      ))}
    </div>
  );
};

const CapacityDemo = () => {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(["outline", "onboarding", "invoice"]));
  const planned = PLANNABLE.filter((task) => picked.has(task.id));
  return (
    <div className="w-full space-y-6">
      <DayColumnHeader weekday="Tue" date="18 Nov" today capacity={360} commitments={2} planned={planned} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tasks planned for the day">
        {PLANNABLE.map((task) => {
          const on = picked.has(task.id);
          return (
            <button
              key={task.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                haptic("toggle");
                setPicked((current) => {
                  const copy = new Set(current);
                  if (on) copy.delete(task.id);
                  else copy.add(task.id);
                  return copy;
                });
              }}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full pr-2 pl-3 text-small transition-[background-color,color,scale] duration-(--dur-press) ease-out active:scale-[0.96]",
                on ? "bg-foreground/[0.09] text-foreground" : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.07]",
              )}
            >
              <AreaDot colour={task.colour} className={cn("transition-opacity", !on && "opacity-40")} />
              {task.title}
              <span className="font-mono text-micro text-faint-foreground">{formatMinutes(task.minutes)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const WorkBlockDemo = () => {
  const [block, setBlock] = useState(WORK_BLOCK);
  return (
    <div className="w-full space-y-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 text-small text-muted-foreground">
        <span>Drag the block, or pull its lower edge</span>
        <span className="font-mono text-foreground">
          <MorphText>{formatRange(block.start, block.start + block.duration)}</MorphText>
          <MorphText className="ml-2 text-muted-foreground">{formatMinutes(block.duration)}</MorphText>
        </span>
      </p>
      <CalendarStrip dayStart={8 * 60} dayEnd={14 * 60} commitments={COMMITMENTS} block={block} onBlockChange={setBlock} />
    </div>
  );
};

const FocusDemo = () => {
  const session = useFocusSession(25 * 60, 24 * 60 + 58);
  return (
    <>
      <FocusTimerPill title="Draft the thesis outline" {...session} />
      <div className="flex gap-1">
        <Button variant="quiet" icon={FastForward} onClick={() => session.skip(300)}>
          Skip 5 minutes
        </Button>
        <Button variant="quiet" icon={ArrowCounterClockwise} iconWeight="bold" onClick={session.restart}>
          Restart
        </Button>
      </div>
    </>
  );
};

const RingDemo = () => {
  const total = 12;
  const [done, setDone] = useState(7);
  return (
    <>
      <div className="flex items-center gap-6">
        <ProgressRing value={done / total} size={112} stroke={9} colour="var(--area-violet)" label="Honours thesis progress">
          <span className="flex items-baseline font-mono">
            <RollingNumber value={done} className="text-title font-medium" />
            <span className="text-small text-muted-foreground">/{total}</span>
          </span>
        </ProgressRing>
        <div>
          <p className="font-medium">Honours thesis</p>
          <p className="flex items-center gap-1.5 text-small text-muted-foreground">
            <AreaDot colour="violet" />
            University
          </p>
          <p className="mt-2 flex items-center gap-2 text-small text-muted-foreground">
            <ProgressPie value={done / total} colour="var(--area-violet)" />
            The sidebar size
          </p>
        </div>
      </div>
      <Button onClick={() => setDone(done >= total ? 0 : done + 1)}>
        <MorphText>{done >= total ? "Start over" : "Complete a Task"}</MorphText>
      </Button>
    </>
  );
};

const PendingDemo = () => {
  const titles = ["Review the onboarding copy", "Review onboarding copy with Sam", "Review the launch copy"];
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<"idle" | "waiting" | "confirmed">("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const rename = () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    setVersion(version + 1);
    setState("waiting");
    timers.current = [setTimeout(() => setState("confirmed"), 2600), setTimeout(() => setState("idle"), 4400)];
  };

  return (
    <>
      <div className="w-full">
        <TaskRow
          task={{
            id: "pending",
            title: titles[version % titles.length] ?? "",
            area: { name: "Korvant", colour: "teal" },
            project: "Launch",
            estimate: 45,
          }}
          completed={false}
          onCompletedChange={() => {}}
          status={state === "idle" ? undefined : <ThingsStatus state={state} />}
        />
      </div>
      <Button icon={PencilSimple} onClick={rename}>
        Rename it
      </Button>
    </>
  );
};

export const HeroToday = () => {
  const [remaining, setRemaining] = useState(TODAY_TASKS.length);
  const session = useFocusSession(25 * 60, 24 * 60 + 58);
  return (
    <div className="relative">
      <div className="rounded-[1.75rem] bg-surface p-1.5">
        <div className="flex items-center gap-2 px-3.5 pt-2 pb-3 text-small">
          <Star weight="fill" className="size-4 text-brand" aria-hidden="true" />
          <span className="font-medium">Today</span>
          <RollingNumber value={remaining} className="font-mono text-faint-foreground" />
          <span className="ml-auto text-faint-foreground">
            Synced<span className="hidden sm:inline"> with Things a few seconds ago</span>
          </span>
        </div>
        <div className="min-h-[27rem] rounded-[1.375rem] bg-surface-inset p-4 pb-12 sm:p-6 sm:pb-14">
          <DayColumnHeader
            weekday="Tue"
            date="18 Nov"
            today
            capacity={360}
            commitments={2}
            planned={[
              { id: "outline", colour: "violet", minutes: 90 },
              { id: "invoice", colour: "orange", minutes: 15 },
              { id: "onboarding", colour: "teal", minutes: 45 },
              { id: "physio", colour: "green", minutes: 15 },
            ]}
          />
          <div className="-mx-3 mt-5">
            <TaskList
              tasks={TODAY_TASKS}
              onRemainingChange={setRemaining}
              renderEmpty={(restore) => (
                <EmptyState
                  spot="today-clear"
                  title="Today is clear"
                  hint="Everything you planned is in the Logbook."
                  action={
                    <Button icon={ArrowCounterClockwise} iconWeight="bold" onClick={restore}>
                      Put them back
                    </Button>
                  }
                />
              )}
            />
          </div>
        </div>
      </div>
      <FocusTimerPill
        title="Draft the thesis outline"
        {...session}
        className="absolute -bottom-5 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2"
      />
    </div>
  );
};

export const TaskSpecimens = () => (
  <>
    <Specimen
      name="Sidebar item"
      note="The Things order: Inbox, Today with its count, then Areas with their Projects. Selection is a tone step, never a coloured bar."
      className="md:col-span-2 xl:col-span-3"
    >
      <SidebarDemo />
    </Specimen>
    <Specimen
      name="Task row"
      note="One line tells you everything: Area dot, Checklist count, the Deadline as an amber flag, the planned start and the Estimate as mono figures. A Someday Task wears a dashed box. Tick one."
      className="md:col-span-4 xl:col-span-9"
      stage="items-stretch justify-center sm:px-4"
    >
      <RowStatesDemo />
    </Specimen>
    <Specimen
      name="Task card"
      note="A Task opens in place, no modal. Notes, a When picker, Estimate chips, Labels, a Checklist you can reorder by its handle, and the Deadline kept apart on the right. Esc or a click outside closes it."
      className="md:col-span-6 xl:col-span-7"
      stage="items-stretch justify-start sm:px-4"
    >
      <TaskCardDemo />
    </Specimen>
    <Specimen
      name="Command palette"
      note="Opens instantly, with no animation, because it is used a hundred times a day. Type to filter, arrows to move, Enter to run."
      className="md:col-span-6 xl:col-span-5"
      stage="bg-surface-inset"
    >
      <CommandPalette commands={COMMANDS} onRun={(command) => toast(`Ran “${command.label}”`)} />
    </Specimen>
    <Specimen
      name="Empty state"
      note="An empty view still says what to do next, in one calm line."
      className="md:col-span-3 xl:col-span-6"
    >
      <EmptyState
        spot="inbox-empty"
        title="The Inbox is empty"
        hint={
          <>
            Press <Kbd>N</Kbd> to capture a thought. Sort it later.
          </>
        }
      />
    </Specimen>
    <Specimen
      name="Waiting for Things"
      note="Things is the boss. An edit shows at once, then waits quietly until the Mac confirms it."
      className="md:col-span-3 xl:col-span-6"
      stage="gap-4 sm:px-4"
    >
      <PendingDemo />
    </Specimen>
  </>
);

export const PlanningSpecimens = () => (
  <>
    <Specimen
      name="Day column header and Capacity meter"
      note="Planned time against free time, one dot per 15 minutes, tinted by Area. Go past Capacity and the extra dots turn red after a gap."
      className="md:col-span-6"
      stage="items-stretch"
    >
      <CapacityDemo />
    </Specimen>
    <Specimen
      name="Work Block"
      note="Lifts when you grab it, tracks your hand, snaps to 15 minutes and settles with a small bounce. External Commitments are hatched and cannot move. Arrow keys work too."
      className="md:col-span-6"
      stage="items-stretch justify-start"
    >
      <WorkBlockDemo />
    </Specimen>
  </>
);

export const ReviewSpecimens = () => {
  const [brush, setBrush] = useState<Brush | null>({ from: 38, to: 51 });
  return (
    <>
      <Specimen
        name="Focus timer pill"
        note="Floats above the app during a Focus Session. The ring of dots drains as the time goes."
        className="md:col-span-3 xl:col-span-4"
        stage="gap-5"
      >
        <FocusDemo />
      </Specimen>
      <Specimen
        name="Project progress ring"
        note="A Project shows how far along it is, in its Area colour. The same shape shrinks to 16 px for the sidebar."
        className="md:col-span-3 xl:col-span-4"
        stage="gap-5"
      >
        <RingDemo />
      </Specimen>
      <Specimen
        name="Shutdown summary"
        note="The end of the day: what got done, Actual Time split by Area, and what rolls to tomorrow."
        className="md:col-span-6 xl:col-span-4"
        stage="items-stretch"
      >
        <ShutdownSummary
          day="Tuesday"
          completed={5}
          planned={7}
          areas={SHUTDOWN_AREAS}
          rolling={["Review the onboarding copy", "Book a physio appointment"]}
        />
      </Specimen>
      <Specimen
        name="Activity timeline"
        note="Nine weeks of completed Tasks. Drag across the dots to brush a range, drag an edge to adjust it, and the count follows."
        className="md:col-span-6 xl:col-span-12"
        stage="items-stretch"
      >
        <ActivityTimeline days={ACTIVITY} brush={brush} onBrushChange={setBrush} />
      </Specimen>
      <Specimen
        name="Estimate against Actual"
        note="Two dot columns a day, one dot per half hour. Hover a day to read it."
        className="md:col-span-3 xl:col-span-6"
        stage="items-stretch"
      >
        <EstimateActual days={WEEK_TOTALS} />
      </Specimen>
      <Specimen
        name="Focus heatmap"
        note="Hour by weekday. Bigger, brighter dots are the hours where the deep work actually happens."
        className="md:col-span-3 xl:col-span-6"
        stage="items-stretch"
      >
        <FocusHeatmap weekdays={HEAT_WEEKDAYS} hours={HEAT_HOURS} minutes={HEAT_MINUTES} />
      </Specimen>
    </>
  );
};

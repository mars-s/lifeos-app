"use client";

import { ArrowsClockwise, Check, DotsThree, Flag, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { Checkbox, Radio, RadioGroup, Switch } from "@/components/ui/choice-controls";
import { KeyCombo } from "@/components/ui/key-hint";
import { Popover } from "@/components/ui/popover-panel";
import { MorphText } from "@/components/ui/morph-text";
import { ProgressBar, SegmentedBar } from "@/components/ui/progress-bar";
import { Segmented } from "@/components/ui/segmented-control";
import { StatusPill, Tag } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast-stack";
import { Tooltip } from "@/components/ui/tooltip-hint";
import { areaVar } from "@/components/lifeos/area";
import { formatMinutes } from "@/components/lifeos/format";
import { showUndo } from "@/components/lifeos/undo";
import { SHUTDOWN_AREAS } from "./sample-data";
import { Specimen } from "./specimen";

const SHORTCUTS = [
  { keys: "mod+k", label: "Command palette" },
  { keys: "n", label: "New Task" },
  { keys: "mod+z", label: "Undo" },
  { keys: "shift+enter", label: "Add a Checklist Item" },
];

export const ControlSpecimens = () => {
  const [view, setView] = useState<"list" | "board" | "calendar">("list");
  const [progress, setProgress] = useState(58);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Specimen
        name="Action button"
        note="One primary per view, ink on paper and silver on graphite. Secondary for the rest, quiet for chrome, tinted red for anything that deletes."
        className="md:col-span-3 xl:col-span-4"
        stage="gap-3"
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary">Plan the day</Button>
          <Button>Add Task</Button>
          <Button variant="quiet">Skip</Button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            icon={Check}
            iconWeight="bold"
            loading={saving}
            onClick={() => {
              setSaving(true);
              setTimeout(() => setSaving(false), 1200);
            }}
          >
            <MorphText>{saving ? "Saving" : "Save"}</MorphText>
          </Button>
          <Button variant="danger" icon={Trash}>
            Delete
          </Button>
          <IconButton icon={DotsThree} iconWeight="bold" label="More" tooltip="More" />
        </div>
      </Specimen>
      <Specimen
        name="Choice controls"
        note="A switch, a borderless checkbox and a radio group. Each sits in a shallow well, so the off state reads without an outline."
        className="md:col-span-3 xl:col-span-4"
        stage="items-start gap-4"
      >
        <Switch defaultChecked label="This Evening" description="Park it at the bottom of Today" />
        <Checkbox defaultChecked label="Show completed Tasks" />
        <RadioGroup label="Focus Session length" defaultValue="25" className="flex gap-5">
          <Radio value="25" label="25 min" />
          <Radio value="50" label="50 min" />
        </RadioGroup>
      </Specimen>
      <Specimen
        name="Segmented control and pills"
        note="The active pill slides with a spring from the pointer and jumps instantly from the keyboard. Pills carry status, tags carry figures."
        className="md:col-span-6 xl:col-span-4"
        stage="gap-5"
      >
        <Segmented
          label="View"
          value={view}
          onValueChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
            { value: "calendar", label: "Calendar" },
          ]}
        />
        <div className="flex flex-wrap justify-center gap-1.5">
          <StatusPill tone="positive" icon={Check} iconWeight="bold">
            Confirmed
          </StatusPill>
          <StatusPill tone="brand" icon={ArrowsClockwise} iconWeight="bold">
            Waiting for Things
          </StatusPill>
          <StatusPill tone="warning" icon={Flag}>
            Due Friday
          </StatusPill>
          <StatusPill tone="negative">Overdue</StatusPill>
          <StatusPill>Someday</StatusPill>
          <Tag>0:30</Tag>
        </div>
      </Specimen>
      <Specimen
        name="Key hints, tooltip, popover"
        note="Keys adapt to the platform. A tooltip waits 300 ms, then the next one opens at once. A popover grows from its trigger."
        className="md:col-span-3 xl:col-span-4"
        stage="items-stretch gap-4"
      >
        <ul className="space-y-2">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-4 text-small">
              {shortcut.label}
              <KeyCombo keys={shortcut.keys} />
            </li>
          ))}
        </ul>
        <div className="flex justify-center gap-2">
          <Tooltip content="Start a Focus Session">
            <Button>Hover me</Button>
          </Tooltip>
          <Popover title="Honours thesis" trigger={<Button>Open a popover</Button>}>
            <p className="px-1 pb-1 text-small text-muted-foreground">
              7 of 12 Tasks done. The next Deadline is Friday 21 November.
            </p>
          </Popover>
        </div>
      </Specimen>
      <Specimen
        name="Meters"
        note="A progress bar for one value, a segmented bar when the parts matter. Both animate their width from where they are."
        className="md:col-span-3 xl:col-span-4"
        stage="items-stretch gap-5"
        aside={
          <Button variant="quiet" onClick={() => setProgress(progress >= 100 ? 16 : Math.min(100, progress + 21))}>
            Advance
          </Button>
        }
      >
        <div className="space-y-2">
          <p className="flex justify-between text-small">
            Honours thesis <span className="font-mono text-muted-foreground">{progress}%</span>
          </p>
          <ProgressBar value={progress} label="Honours thesis progress" />
        </div>
        <div className="space-y-2">
          <p className="flex justify-between text-small">
            Actual Time by Area <span className="font-mono text-muted-foreground">4:35 of 6:00</span>
          </p>
          <SegmentedBar
            label="Actual Time by Area"
            max={360}
            segments={SHUTDOWN_AREAS.map((area) => ({
              id: area.name,
              value: area.minutes,
              label: `${area.name} ${formatMinutes(area.minutes)}`,
              color: areaVar(area.colour),
            }))}
          />
        </div>
      </Specimen>
      <Specimen
        name="Undo toast"
        note="Every change raises one. Click Undo, swipe it away, or let it go. They stack, fan out on hover and pause while you read."
        className="md:col-span-6 xl:col-span-4"
        stage="gap-3"
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => showUndo("Completed “Book a physio appointment”", () => toast("Back in Today"))}>
            Complete a Task
          </Button>
          <Button onClick={() => showUndo("Moved to Tomorrow", () => toast("Back in Today"))}>Reschedule</Button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="quiet"
            onClick={() =>
              toast.promise(new Promise((resolve) => setTimeout(resolve, 1100)), {
                loading: "Closing the day",
                success: "Day closed",
                error: "Could not close the day",
              })
            }
          >
            Confirm
          </Button>
          <Button
            variant="quiet"
            onClick={() =>
              toast.error("Could not save the Estimate", {
                description: "Your edit is kept. Check the connection.",
                action: { label: "Retry", onClick: () => toast.success("Estimate saved") },
              })
            }
          >
            Fail to save
          </Button>
        </div>
        <p className="flex items-center gap-2 text-small text-muted-foreground">
          Or press <KeyCombo keys="mod+z" /> anywhere
        </p>
      </Specimen>
    </>
  );
};

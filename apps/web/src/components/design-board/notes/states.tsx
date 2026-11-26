"use client";

import { ArrowCounterClockwise, BookOpen, DeviceMobile, NotePencil } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/action-button";
import { Segmented } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import type { SyncState } from "./model";
import { Fold, SyncIndicator } from "./parts";
import { NOTE_TYPE } from "./prose";

const PAGE_COLUMNS = 7;
const PAGE_ROWS = 6;
const WRITTEN: ReadonlySet<string> = new Set(["0-1", "1-1", "2-1", "3-1", "4-1", "0-2", "1-2", "2-2"]);

const NotebookArt = () => (
  <svg viewBox="0 0 132 76" aria-hidden="true" className="h-[4.75rem] w-[8.25rem]">
    {[0, 1].map((page) =>
      Array.from({ length: PAGE_COLUMNS * PAGE_ROWS }, (_, index) => {
        const column = index % PAGE_COLUMNS;
        const row = Math.floor(index / PAGE_COLUMNS);
        const written = page === 0 && WRITTEN.has(`${column}-${row}`);
        return (
          <circle
            key={`${page}-${index}`}
            cx={8 + page * 68 + column * 8}
            cy={10 + row * 11}
            r={written ? 2 : 1.25}
            className={written ? "fill-brand" : "fill-foreground opacity-20"}
          />
        );
      }),
    )}
    <line x1="66" y1="4" x2="66" y2="72" strokeWidth="1" strokeLinecap="round" className="stroke-foreground/15" />
  </svg>
);

const Empty = ({ art, title, hint, children }: { art?: ReactNode; title: string; hint: string; children?: ReactNode }) => (
  <div className="flex max-w-xs flex-col items-center gap-3 text-center">
    {art}
    <div className="space-y-1">
      <p className="font-medium">{title}</p>
      <p className="text-small text-pretty text-muted-foreground">{hint}</p>
    </div>
    {children && <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>}
  </div>
);

const SYNC_STATES = {
  synced: { kind: "synced", devices: 3 },
  offline: { kind: "offline", waiting: 4 },
  merging: { kind: "merging", edits: 2, from: "iPhone" },
} as const satisfies Record<SyncState["kind"], SyncState>;

const SYNC_NOTES: Record<SyncState["kind"], string> = {
  synced: "At rest it is one green dot. The words show in the sidebar foot and on hover.",
  offline: "A hollow dot, no red. Offline is normal here, and every edit is kept on this device.",
  merging: "Three dots pulse while edits arrive, then the words morph back to Synced.",
};

const SyncStates = () => {
  const [kind, setKind] = useState<SyncState["kind"]>("synced");
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5">
      <Segmented
        label="Sync state"
        value={kind}
        onValueChange={setKind}
        options={[
          { value: "synced", label: "Synced" },
          { value: "offline", label: "Offline" },
          { value: "merging", label: "Merging" },
        ]}
      />
      <div className="flex w-full items-center justify-between rounded-xl bg-foreground/[0.03] px-4 py-3">
        <SyncIndicator state={SYNC_STATES[kind]} />
        <span className="grid size-8 place-items-center rounded-full bg-foreground/[0.05]">
          <SyncIndicator state={SYNC_STATES[kind]} words={false} />
        </span>
      </div>
      <p className="min-h-10 text-center text-small text-pretty text-muted-foreground">{SYNC_NOTES[kind]}</p>
    </div>
  );
};

type MergePhase = "idle" | "merging" | "merged";

const ARRIVED = "bg-transparent transition-[background-color] duration-[1800ms] ease-out starting:bg-brand/20";

const MergeMoment = () => {
  const [phase, setPhase] = useState<MergePhase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const play = () => {
    clearTimeout(timer.current);
    setPhase("merging");
    timer.current = setTimeout(() => setPhase("merged"), 900);
  };
  const sync: SyncState = phase === "merging" ? { kind: "merging", edits: 2, from: "iPhone" } : { kind: "synced", devices: 3 };
  const merged = phase === "merged";
  return (
    <div className="w-full max-w-[30rem]">
      <div className="flex h-8 items-center justify-between">
        <SyncIndicator state={sync} />
        <Button
          variant={phase === "idle" ? "secondary" : "quiet"}
          size="sm"
          icon={phase === "idle" ? DeviceMobile : ArrowCounterClockwise}
          iconWeight={phase === "idle" ? "fill" : "bold"}
          disabled={phase === "merging"}
          onClick={phase === "merged" ? () => setPhase("idle") : play}
        >
          {phase === "idle" ? "Edit from iPhone" : "Reset"}
        </Button>
      </div>
      <div className={cn("mt-3 select-text", NOTE_TYPE.reading.body)}>
        <p className="text-pretty">
          Both runs use the same{" "}
          {merged ? (
            <span key="new" className={cn("-mx-0.5 rounded-[4px] px-0.5", ARRIVED)}>
              1,500
            </span>
          ) : (
            "1,200"
          )}{" "}
          questions. The dense model is a small bi-encoder, fine-tuned for one epoch.
        </p>
        <Fold open={merged}>
          {merged && (
            <p className={cn("-mx-2 mt-4 rounded-lg px-2 text-pretty", ARRIVED)}>The extra 300 questions come from the second-year notes, added on the train home.</p>
          )}
        </Fold>
        <p className="mt-4 text-pretty text-foreground/80">Recall is the number the reader will care about.</p>
      </div>
    </div>
  );
};

export const StateSpecimens = () => (
  <>
    <Specimen name="No notes yet" note="A dotted page with one line written, and two ways to start. No illustration fights the page." className="md:col-span-3 xl:col-span-4">
      <Empty art={<NotebookArt />} title="Nothing written yet" hint="Start with today, or type in a page from your notebook.">
        <Button variant="primary" size="sm" icon={NotePencil}>
          New note
        </Button>
        <Button size="sm" icon={BookOpen}>
          From the notebook
        </Button>
      </Empty>
    </Specimen>
    <Specimen name="An empty Area" note="The Area exists in the Planner already, so the empty state says where its notes will show up." className="md:col-span-3 xl:col-span-4">
      <Empty title="No notes in Chemwatch" hint="Notes you file here also show on the Area’s page in the Planner.">
        <Button size="sm" icon={NotePencil}>
          New note in Chemwatch
        </Button>
      </Empty>
    </Specimen>
    <Specimen name="No links yet" note="The links panel never sits blank. It says what would fill it, in one line." className="md:col-span-6 xl:col-span-4">
      <Empty title="Nothing links here yet" hint="Type [[ in another note, or paste this note into a Task, and it will show up here." />
    </Specimen>
    <Specimen name="Sync, quietly" note="One dot and a few words. No banner, no spinner and no red, because working offline is the normal case." className="md:col-span-6 xl:col-span-5">
      <SyncStates />
    </Specimen>
    <Specimen
      name="The merge moment"
      note="Edits from another device fold in where they belong, with a tint that fades in under two seconds. Nothing to press, nothing to resolve."
      className="md:col-span-6 xl:col-span-7"
    >
      <MergeMoment />
    </Specimen>
  </>
);

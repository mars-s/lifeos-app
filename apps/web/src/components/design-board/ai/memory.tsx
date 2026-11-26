"use client";

import { BookmarkSimple, PushPin, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/action-button";
import { Switch } from "@/components/ui/choice-controls";
import { toast } from "@/components/ui/toast-stack";
import { showUndo } from "@/components/lifeos/undo";
import { cn } from "@/lib/utils";
import { Fold, SearchPill } from "../notes/parts";
import { Specimen } from "../specimen";
import { Remembered } from "./agent";
import type { IndexRow, Memory, MemoryGroup } from "./model";
import { AI_RING, PencilChip } from "./parts";
import { INDEX_ROWS, MEMORIES, MEMORY_GROUPS, RUN_LEARNT, TASK_ESTIMATE } from "./sample";

const GROUP_ORDER: MemoryGroup[] = ["you", "work", "people"];
const count = new Intl.NumberFormat("en-AU");

const MemoryEdit = ({ memory, onSave }: { memory: Memory; onSave: (text: string | undefined) => void }) => {
  const cancelled = useRef(false);
  return (
    <input
      type="text"
      name={`memory-${memory.id}`}
      aria-label="Edit this memory"
      autoComplete="off"
      autoFocus
      defaultValue={memory.text}
      onBlur={(event) => !cancelled.current && onSave(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          onSave(undefined);
        }
      }}
      className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded-md bg-foreground/[0.06] px-1.5 text-body shadow-[inset_0_0_0_1.5px] shadow-foreground/25 outline-none"
    />
  );
};

const MemoryText = ({ memory, editing, refocus, onEdit, onSave }: { memory: Memory; editing: boolean; refocus: boolean; onEdit: () => void; onSave: (text: string | undefined) => void }) =>
  editing ? (
    <MemoryEdit memory={memory} onSave={onSave} />
  ) : (
    <button
      type="button"
      autoFocus={refocus}
      onClick={onEdit}
      className="block w-full rounded-md text-left text-pretty"
    >
      <span className="sr-only">Edit: </span>
      {memory.text}
    </button>
  );

const TOOL = "size-7 transition-[opacity,background-color,color,scale] focus-visible:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100";

const MemoryPanel = () => {
  const [memories, setMemories] = useState(MEMORIES);
  const [on, setOn] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const shown = memories.filter((memory) => needle === "" || memory.text.toLowerCase().includes(needle));

  const change = (words: string, next: Memory[]) => {
    const before = memories;
    setMemories(next);
    showUndo(words, () => setMemories(before), "ai-memory");
  };
  const patch = (id: string, fields: Partial<Memory>) => memories.map((candidate) => (candidate.id === id ? { ...candidate, ...fields } : candidate));
  const save = (memory: Memory, text: string | undefined) => {
    setEdited(memory.id);
    setEditing(null);
    const next = text?.trim();
    if (!next || next === memory.text) return;
    change("Memory edited", patch(memory.id, { text: next, from: "Edited by you just now" }));
  };
  const row = (memory: Memory) => (
    <li key={memory.id} className="group/memory relative flex items-start gap-1 py-2">
      <div className="min-w-0 flex-1 pr-1">
        <MemoryText memory={memory} editing={editing === memory.id} refocus={edited === memory.id} onEdit={() => setEditing(memory.id)} onSave={(text) => save(memory, text)} />
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-micro text-muted-foreground">
          <span>{memory.from}</span>
          {memory.pinned ? <span>Always used</span> : memory.used > 0 && <span>Used {memory.used} times</span>}
        </p>
      </div>
      <IconButton
        icon={PushPin}
        iconWeight={memory.pinned ? "fill" : "bold"}
        label={`Pin, so it is always used: ${memory.text}`}
        aria-pressed={memory.pinned}
        onClick={() => change(memory.pinned ? "Unpinned" : "Pinned", patch(memory.id, { pinned: !memory.pinned, fresh: false }))}
        className={cn(TOOL, memory.pinned ? "text-foreground" : "opacity-0 group-hover/memory:opacity-100")}
      />
      <IconButton
        icon={X}
        iconWeight="bold"
        label={`Forget: ${memory.text}`}
        onClick={() => {
          change("Forgotten", memories.filter((candidate) => candidate.id !== memory.id));
          root.current?.focus({ preventScroll: true });
        }}
        className={cn(TOOL, "opacity-0 group-hover/memory:opacity-100")}
      />
    </li>
  );
  const sections = [
    { id: "fresh", title: "New this week", rows: shown.filter((memory) => memory.fresh) },
    { id: "pinned", title: "Pinned", rows: shown.filter((memory) => memory.pinned && !memory.fresh) },
    ...GROUP_ORDER.map((group) => ({ id: group, title: MEMORY_GROUPS[group], rows: shown.filter((memory) => memory.group === group && !memory.pinned && !memory.fresh) })),
  ].filter((section) => section.rows.length > 0);

  return (
    <div ref={root} tabIndex={-1} className={cn("w-full max-w-[36rem] self-center outline-none", AI_RING)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-title font-semibold">Memory</h4>
          <p className="text-small text-pretty text-muted-foreground">
            What LifeOS AI has learnt from what you said and did. Never a guess. <span className="font-mono">{memories.length}</span> {memories.length === 1 ? "memory" : "memories"}.
          </p>
        </div>
        <Switch checked={on} onCheckedChange={setOn} aria-label="Memory" className="shrink-0" />
      </div>
      <Fold open={!on}>
        <p className="mt-4 rounded-xl bg-foreground/[0.04] px-3 py-2.5 text-small text-pretty text-muted-foreground">Off. Nothing new is remembered and nothing below is used. The rest of LifeOS AI still works.</p>
      </Fold>
      <SearchPill value={query} onChange={setQuery} placeholder="Search memory…" label="Search memory" className="mt-4" />
      <span role="status" className="sr-only">
        {needle === "" ? "" : `${shown.length} of ${memories.length} memories match`}
      </span>

      <div className={cn("transition-opacity duration-(--dur-base) ease-out", !on && "opacity-50")}>
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`memory-${section.id}`} className="mt-5">
            <h5 id={`memory-${section.id}`} className="text-small font-medium text-muted-foreground">
              {section.title}
            </h5>
            <ul>{section.rows.map(row)}</ul>
          </section>
        ))}
      </div>
      {shown.length === 0 && (
        <p className="mt-8 text-center text-small text-pretty text-muted-foreground">{memories.length === 0 ? "Nothing remembered. It starts again with the next thing you tell it." : `Nothing in memory matches “${query.trim()}”.`}</p>
      )}
      {memories.length > 0 && (
        <div className="mt-6 -ml-3">
          <Button
            variant="quiet"
            onClick={() => {
              change(`Forgot ${memories.length} memories`, []);
              root.current?.focus({ preventScroll: true });
            }}
          >
            Forget everything
          </Button>
        </div>
      )}
    </div>
  );
};

const BAR_DOTS = 20;

const IndexLine = ({ row }: { row: IndexRow }) => {
  const filled = Math.floor((row.indexed / row.total) * BAR_DOTS);
  const behind = row.total - row.indexed;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 @sm:grid-cols-[minmax(0,1fr)_auto_3.5rem]">
      <span className="min-w-0">
        <span className="block truncate text-small">{row.label}</span>
        <span className="block truncate text-micro text-faint-foreground">{behind > 0 ? `${count.format(behind)} sections still to index` : row.detail}</span>
      </span>
      <span
        role="meter"
        aria-label={`${row.label} indexed`}
        aria-valuemin={0}
        aria-valuemax={row.total}
        aria-valuenow={row.indexed}
        className="col-span-2 row-start-2 flex items-center gap-[3px] @sm:col-span-1 @sm:row-start-auto"
      >
        {Array.from({ length: BAR_DOTS }, (_, index) => (
          <span
            key={index}
            className={cn("size-1.5 shrink-0 rounded-full", index < filled ? "bg-foreground/60" : "animate-pending bg-brand motion-reduce:animate-none")}
            style={index < filled ? undefined : { animationDelay: `${(index - filled) * 160}ms` }}
          />
        ))}
      </span>
      <span className="text-right font-mono text-small text-foreground/80">{count.format(row.indexed)}</span>
    </li>
  );
};

const IndexPanel = () => (
  <div className="@container w-full max-w-[27rem] self-center">
    <ul className="space-y-3">
      {INDEX_ROWS.map((row) => (
        <IndexLine key={row.id} row={row} />
      ))}
    </ul>
    <p className="mt-5 flex items-center gap-2 text-small text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-positive/80" />
      Up to date 2 min ago
    </p>
    <p className="mt-1 text-small text-pretty text-muted-foreground">Your notes stay on your devices. The index holds a short snippet of each section, and search works even with AI turned off.</p>
  </div>
);

const Scene = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="text-micro font-medium text-faint-foreground">{label}</p>
    <div className="mt-2">{children}</div>
  </div>
);

const OnTheAnswer = () => {
  const [undone, setUndone] = useState(false);
  const memory = MEMORIES.find((candidate) => candidate.id === "over");
  return (
    <div className="w-full max-w-[25rem] space-y-7 self-center">
      <Scene label="When it learns something">
        <p className="mb-2.5 text-small text-pretty">Planned the outline for Thu 2:30 pm and moved the reading to Friday.</p>
        <Remembered part={{ kind: "remembered", text: RUN_LEARNT, undone }} onUndo={() => setUndone(!undone)} />
      </Scene>
      <Scene label="When it uses something">
        <p className="flex items-center gap-2 text-small text-muted-foreground">
          Estimate
          <PencilChip pencil>0:15</PencilChip>
        </p>
        <p className="mt-2 text-small text-pretty text-muted-foreground">{TASK_ESTIMATE.why}</p>
        {memory && (
          <div className="mt-3 rounded-xl bg-popover p-3 shadow-float">
            <p className="flex items-center gap-1.5 text-micro font-medium text-muted-foreground">
              <BookmarkSimple weight="fill" className="size-3.5" aria-hidden="true" />
              From memory
            </p>
            <p className="mt-1.5 text-pretty">{memory.text}</p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              {memory.from} · Used {memory.used} times
            </p>
            <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
              <Button variant="secondary" onClick={() => toast("Opens the sentence to edit", { id: "memory-use" })} className="h-7 px-3">
                Edit
              </Button>
              <Button variant="quiet" onClick={() => toast("Forgotten", { id: "memory-use" })} className="h-7 px-2.5">
                Forget
              </Button>
              <Button variant="quiet" onClick={() => toast("Left out of this answer", { id: "memory-use" })} className="h-7 px-2.5">
                Not this time
              </Button>
            </div>
          </div>
        )}
      </Scene>
    </div>
  );
};

export const MemorySpecimens = () => (
  <>
    <Specimen
      name="What it remembers"
      note="One page in Settings, under AI. Click a sentence to rewrite it. Pin one and it is used every time. Forget really deletes it. The switch turns memory off and leaves the rest of AI on."
      className="md:col-span-6 xl:col-span-7 xl:row-span-2"
      stage="items-stretch justify-start px-6 sm:px-9"
    >
      <MemoryPanel />
    </Specimen>
    <Specimen
      name="On the answer"
      note="A new memory shows as a chip under the answer that made it, with Undo. A memory that shaped an answer shows as a chip too. Press it to fix it there."
      className="md:col-span-3 xl:col-span-5"
      stage="items-stretch justify-center"
    >
      <OnTheAnswer />
    </Specimen>
    <Specimen
      name="Everything indexed"
      note="One index, six sources, one search. A dot bar shows how far along each is. Blue dots are still to come."
      className="md:col-span-3 xl:col-span-5"
      stage="items-stretch justify-center"
    >
      <IndexPanel />
    </Specimen>
  </>
);

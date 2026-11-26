"use client";

import { ArrowCounterClockwise, Note as NoteIcon, Plus } from "@phosphor-icons/react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/action-button";
import { Kbd, KeyCombo } from "@/components/ui/key-hint";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { showUndo } from "@/components/lifeos/undo";
import { cn } from "@/lib/utils";
import { Specimen } from "../specimen";
import { bestMatches, NOTE_IDS, PROJECT_IDS, TASK_IDS, type Block, type EntityRef, type NoteId, type Todo } from "./model";
import { GLASS } from "./parts";
import { Callout, EntityChip, LabelPill, NOTE_TYPE, NoteProse, TodoLine, WikiLink } from "./prose";
import { AREAS, areaOf, NOTES, placeOf, PROJECTS, TASKS } from "./sample";

const idle = { todoDone: () => false, onToggleTodo: () => {} };

const PREVIEW: Block[] = [
  { kind: "heading", level: 2, text: ["Why the hybrid works"] },
  {
    kind: "paragraph",
    text: ["Sparse and dense fail on ", { kind: "strong", text: "different questions" }, ". Adding the two scores keeps what each one gets right, as in ", { kind: "note", id: "dense-sparse" }, "."],
  },
  { kind: "quote", text: ["Measure the thing you will argue about, not the thing that is easy to measure."] },
  { kind: "bullets", items: [["Keep the weight fixed at first"], ["Tune it only on the held-out set"]] },
];

const LivePreview = () => {
  const [active, setActive] = useState<number | undefined>(0);
  return (
    <div className="w-full max-w-[34rem] self-start pl-6 @2xl:pl-16">
      <NoteProse blocks={PREVIEW} editor={{ ...idle, active, onActivate: setActive }} />
    </div>
  );
};

type Suggestion = { kind: "note"; id: NoteId } | { kind: "entity"; ref: EntityRef } | { kind: "create"; title: string };

const suggestionKey = (suggestion: Suggestion) =>
  suggestion.kind === "note" ? `note-${suggestion.id}` : suggestion.kind === "entity" ? `${suggestion.ref.kind}-${suggestion.ref.id}` : "create";

const suggest = (query: string) => {
  const needle = query.trim().toLowerCase();
  const notes: Suggestion[] = bestMatches(
    NOTE_IDS.filter((id) => !NOTES[id].day),
    (id) => NOTES[id].title,
    query,
  )
    .slice(0, 3)
    .map((id) => ({ kind: "note", id }));
  const tasks: Suggestion[] = bestMatches(TASK_IDS, (id) => TASKS[id].title, query)
    .slice(0, 1)
    .map((id) => ({ kind: "entity", ref: { kind: "task", id } }));
  const projects: Suggestion[] = bestMatches(PROJECT_IDS, (id) => PROJECTS[id].title, query)
    .slice(0, 1)
    .map((id) => ({ kind: "entity", ref: { kind: "project", id } }));
  const exact = NOTE_IDS.some((id) => NOTES[id].title.toLowerCase() === needle);
  const create: Suggestion[] = needle && !exact ? [{ kind: "create", title: query.trim() }] : [];
  return [...notes, ...tasks, ...projects, ...create];
};

const Matched = ({ text, query }: { text: string; query: string }) => {
  const at = query.trim() ? text.toLowerCase().indexOf(query.trim().toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-foreground">{text.slice(at, at + query.trim().length)}</span>
      {text.slice(at + query.trim().length)}
    </>
  );
};

const SuggestionRow = ({ suggestion, query }: { suggestion: Suggestion; query: string }) => {
  if (suggestion.kind === "create")
    return (
      <>
        <Plus weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          New note “{suggestion.title}”
        </span>
      </>
    );
  if (suggestion.kind === "note") {
    const area = areaOf(suggestion.id);
    return (
      <>
        <NoteIcon weight="fill" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-foreground/85">
          <Matched text={NOTES[suggestion.id].title} query={query} />
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-micro text-faint-foreground">
          {placeOf(suggestion.id)}
          {area && <AreaDot colour={area.colour} className="size-1.5" />}
        </span>
      </>
    );
  }
  const { ref } = suggestion;
  if (ref.kind === "task")
    return (
      <>
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          <span className="size-3.5 rounded-[4.5px] shadow-[inset_0_0_0_1.5px] shadow-foreground/35" />
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/85">
          <Matched text={TASKS[ref.id].title} query={query} />
        </span>
        <span className="shrink-0 text-micro text-faint-foreground">Task</span>
      </>
    );
  if (ref.kind === "project")
    return (
      <>
        <ProgressPie value={PROJECTS[ref.id].progress} colour={areaVar(AREAS[PROJECTS[ref.id].area].colour)} />
        <span className="min-w-0 flex-1 truncate text-foreground/85">
          <Matched text={PROJECTS[ref.id].title} query={query} />
        </span>
        <span className="shrink-0 text-micro text-faint-foreground">Project</span>
      </>
    );
  return null;
};

const LinkAutocomplete = () => {
  const listId = useId();
  const [query, setQuery] = useState("re");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const suggestions = suggest(query);
  const active = suggestions[Math.min(index, suggestions.length - 1)];
  const reset = () => {
    setPicked(null);
    setQuery("");
    setIndex(0);
  };
  return (
    <div className={cn("w-full max-w-[26rem] self-start", NOTE_TYPE.reading.body)}>
      <p className="text-pretty text-foreground/80">The hybrid is the cheap win. The numbers that back it up are in</p>
      {picked ? (
        <p className="flex min-h-[1lh] flex-wrap items-center gap-x-2">
          <span className="animate-fade-in">
            {picked.kind === "note" && <WikiLink id={picked.id} />}
            {picked.kind === "entity" && <EntityChip entity={picked.ref} />}
            {picked.kind === "create" && <span className="text-brand">{picked.title}</span>}
          </span>
          <Button variant="quiet" size="sm" icon={ArrowCounterClockwise} iconWeight="bold" onClick={reset} className="h-7 px-2.5">
            Try another
          </Button>
        </p>
      ) : (
        <div className="relative">
          <label className="-mx-1 flex w-fit items-center rounded-md px-1 transition-colors duration-(--dur-fast) focus-within:bg-brand/[0.07]">
            <span aria-hidden="true" className="font-mono text-[0.8125em] text-faint-foreground">
              [[
            </span>
            <span className="inline-grid min-w-[1ch]">
              <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre">
                {query || " "}
              </span>
              <input
                type="text"
                size={1}
                role="combobox"
                name="wiki-link"
                aria-label="Link to a note, Task or Project"
                aria-expanded={suggestions.length > 0}
                aria-controls={listId}
                aria-activedescendant={active ? `${listId}-${suggestionKey(active)}` : undefined}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setIndex((Math.min(index, suggestions.length - 1) + step + suggestions.length) % Math.max(1, suggestions.length));
                  }
                  if (event.key === "Enter" && active) setPicked(active);
                  if (event.key === "Escape") setQuery("");
                }}
                className="col-start-1 row-start-1 w-full min-w-0 bg-transparent text-brand outline-none"
              />
            </span>
            <span aria-hidden="true" className="font-mono text-[0.8125em] text-faint-foreground">
              ]]
            </span>
          </label>
          <div className={cn("absolute top-full left-0 z-10 mt-2 w-full max-w-[21rem] rounded-xl p-1 text-small", GLASS)}>
            <ul id={listId} role="listbox" aria-label="Suggestions">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestionKey(suggestion)}
                  id={`${listId}-${suggestionKey(suggestion)}`}
                  role="option"
                  aria-selected={suggestion === active}
                  onPointerMove={() => setIndex(suggestions.indexOf(suggestion))}
                  onClick={() => setPicked(suggestion)}
                  className={cn("flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2", suggestion === active && "bg-foreground/[0.07]")}
                >
                  <SuggestionRow suggestion={suggestion} query={query} />
                </li>
              ))}
              {suggestions.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">Type a title to link or create a note</li>}
            </ul>
            <p className="mt-1 flex items-center gap-3 border-t border-border px-2 pt-1.5 pb-1 text-micro text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> Link
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>|</Kbd> Rename
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Kbd>Esc</Kbd>
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const LINES: Todo[] = [
  { id: "line-rerun", done: false, text: ["Rerun the hybrid on the small index"] },
  { id: "line-email", done: false, text: ["Email Dr Nguyen the new table"] },
  { id: "line-cards", done: true, text: ["Check the questions for duplicates"] },
];

const LineToTask = () => {
  const [made, setMade] = useState<ReadonlySet<string>>(new Set(["line-email"]));
  const [done, setDone] = useState<Record<string, boolean>>(Object.fromEntries(LINES.map((line) => [line.id, line.done])));
  const make = (id: string) => {
    setMade((current) => new Set([...current, id]));
    showUndo("Task added to Honours thesis", () => setMade((current) => new Set([...current].filter((other) => other !== id))), `line-${id}`);
  };
  return (
    <div className={cn("w-full max-w-[30rem]", NOTE_TYPE.reading.body)}>
      <ul className="space-y-1">
        {LINES.map((line) => (
          <TodoLine
            key={line.id}
            todo={made.has(line.id) ? { ...line, task: "rerun" } : line}
            done={done[line.id] ?? false}
            onToggle={() => setDone((current) => ({ ...current, [line.id]: !current[line.id] }))}
            onMakeTask={() => make(line.id)}
            toolAlways
          />
        ))}
      </ul>
      <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted-foreground">
        <KeyCombo keys="mod+enter" /> on a line does the same. The Task takes the note’s Area and Project.
      </p>
    </div>
  );
};

const Chips = () => (
  <div className={cn("w-full max-w-[28rem] space-y-4", NOTE_TYPE.reading.body)}>
    <p className="text-pretty">
      Before Sunday, finish <EntityChip entity={{ kind: "task", id: "outline-draft" }} /> for <EntityChip entity={{ kind: "project", id: "thesis" }} />.
    </p>
    <p className="text-pretty">
      The pricing idea belongs to <EntityChip entity={{ kind: "area", id: "paperless" }} /> and needs a quiet morning. <LabelPill name="Deep Work" className="-translate-y-px" />
    </p>
  </div>
);

const CALLOUT_SET = [
  { tone: "note", title: "Note", text: "Both runs share one question set." },
  { tone: "idea", title: "Idea", text: "Report the hybrid as its own section." },
  { tone: "question", title: "Question", text: "Does the gain hold on a small index?" },
  { tone: "warning", title: "Check this", text: "The frozen model saw 40 of these questions." },
] as const;

const Callouts = () => (
  <div className="grid w-full gap-2.5 text-body @md:grid-cols-2">
    {CALLOUT_SET.map((callout) => (
      <Callout key={callout.tone} tone={callout.tone} title={callout.title}>
        <p className="text-pretty">{callout.text}</p>
      </Callout>
    ))}
  </div>
);

const blocksOf = (id: NoteId, kinds: Block["kind"][]) => NOTES[id].blocks.filter((block) => kinds.includes(block.kind));

const TYPE_SCALE: { name: string; spec: string; sample: ReactNode; className: string }[] = [
  { name: "Title", spec: "28 / 34 · 600", sample: "Retrieval experiments", className: NOTE_TYPE.reading.title },
  { name: "Heading 1", spec: "22 / 28 · 600", sample: "First runs", className: NOTE_TYPE.reading.headings[1] },
  { name: "Heading 2", spec: "18 / 26 · 600", sample: "What I need to show", className: NOTE_TYPE.reading.headings[2] },
  { name: "Heading 3", spec: "16 / 26 · 600", sample: "Negatives", className: NOTE_TYPE.reading.headings[3] },
  { name: "Body", spec: "16 / 26 · 400", sample: "Both runs use the same 1,200 questions.", className: NOTE_TYPE.reading.body },
  { name: "Aside", spec: "13 / 20 · 400", sample: "Edited 2 min ago", className: "text-small text-muted-foreground" },
  { name: "Code", spec: "13 / 22 · mono", sample: "recall@10", className: "font-mono text-[0.8125rem] leading-[1.375rem]" },
];

const TypeScale = () => (
  <dl className="w-full divide-y divide-border">
    {TYPE_SCALE.map((row) => (
      <div key={row.name} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-2.5 @max-md:grid-cols-[minmax(0,1fr)_auto]">
        <dt className="text-small text-muted-foreground">{row.name}</dt>
        <dd className={cn("truncate @max-md:col-span-2 @max-md:row-start-2", row.className)}>{row.sample}</dd>
        <dd className="font-mono text-micro text-faint-foreground">{row.spec}</dd>
      </div>
    ))}
  </dl>
);

export const WritingSpecimens = () => (
  <>
    <Specimen
      name="Live preview"
      note="Click a line. Its Markdown marks hang in the margin and a bar shows where you are, so the words never jump sideways."
      className="md:col-span-6 xl:col-span-7"
      stage="items-stretch justify-start"
    >
      <LivePreview />
    </Specimen>
    <Specimen
      name="Linking as you type"
      note="Two brackets open one list of notes, Tasks and Projects. Arrow keys and Enter, no waiting, and a new note is always the last row."
      className="md:col-span-6 xl:col-span-5"
      stage="items-stretch justify-start min-h-[24rem]"
    >
      <LinkAutocomplete />
    </Specimen>
    <Specimen
      name="A line becomes a Task"
      note="A round box is a to-do that lives in the note. Make Task turns it into a real Task with the square box, and it can be undone."
      className="md:col-span-6 xl:col-span-7"
    >
      <LineToTask />
    </Specimen>
    <Specimen
      name="Tasks, Projects and Areas"
      note="Links to the Planner are chips you can press. A Task chip is the Task itself: tick it here and it is done everywhere."
      className="md:col-span-6 xl:col-span-5"
    >
      <Chips />
    </Specimen>
    <Specimen name="Callouts" note="A soft tint, an icon and a plain title. Amber stays out, because amber means Deadline." className="md:col-span-6 xl:col-span-6">
      <Callouts />
    </Specimen>
    <Specimen name="Table and code" note="Figures sit in Geist Mono and line up on the right. No grid lines, only a step of tone." className="md:col-span-6 xl:col-span-6" stage="items-stretch">
      <NoteProse blocks={blocksOf("retrieval", ["table", "code"])} size="compact" editor={idle} className="w-full" />
    </Specimen>
    <Specimen name="Image and quote" note="An image keeps a 12 px corner and a caption. A quote is a soft bar and quieter ink." className="md:col-span-6 xl:col-span-6" stage="items-stretch">
      <NoteProse blocks={[...blocksOf("japan", ["image"]), ...blocksOf("retrieval", ["quote"])]} size="compact" editor={idle} className="mx-auto w-full max-w-[26rem]" />
    </Specimen>
    <Specimen
      name="Type on the page"
      note="One step larger than the app’s body text, with a 26 px line for long reading, in a column no wider than 700 px."
      className="md:col-span-6 xl:col-span-6"
      stage="items-stretch"
    >
      <TypeScale />
    </Specimen>
  </>
);

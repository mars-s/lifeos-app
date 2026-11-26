"use client";

import { ArrowBendUpRight, Info, Lightbulb, Question, Warning, type Icon } from "@phosphor-icons/react";
import { createContext, use, type ReactNode } from "react";
import { Tag } from "@/components/ui/status-pill";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { ProgressPie } from "@/components/lifeos/progress-ring";
import { StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import type { Block, CalloutTone, EntityRef, Inline, NoteId, TaskId, Todo } from "./model";
import { AREAS, LABELS, PROJECTS, TASKS, titleOf } from "./sample";

export type NotesActions = {
  taskDone: (id: TaskId) => boolean;
  toggleTask: (id: TaskId) => void;
  openNote: (id: NoteId) => void;
  openEntity: (ref: EntityRef) => void;
};

export const NotesContext = createContext<NotesActions>({
  taskDone: (id) => TASKS[id].done,
  toggleTask: () => {},
  openNote: () => {},
  openEntity: () => {},
});

export type ProseSize = "reading" | "compact";

export const NOTE_TYPE = {
  reading: {
    title: "text-[1.75rem] leading-[2.125rem] font-semibold tracking-[-0.022em]",
    body: "text-[1rem] leading-[1.625rem]",
    headings: {
      1: "text-[1.375rem] leading-7 font-semibold tracking-[-0.018em]",
      2: "text-[1.125rem] leading-[1.625rem] font-semibold tracking-[-0.012em]",
      3: "text-[1rem] leading-[1.625rem] font-semibold",
    },
  },
  compact: {
    title: "text-title font-semibold",
    body: "text-body",
    headings: {
      1: "text-[1.1875rem] leading-[1.625rem] font-semibold tracking-[-0.015em]",
      2: "text-heading font-semibold",
      3: "text-body font-semibold",
    },
  },
} as const satisfies Record<ProseSize, { title: string; body: string; headings: Record<1 | 2 | 3, string> }>;

const CHIP = "mx-0.5 inline-flex h-6 max-w-full -translate-y-px items-center gap-1.5 rounded-full bg-(image:--button-secondary) align-middle text-small font-medium text-foreground";
const CHIP_PRESS = "transition-[scale,background-image] duration-(--dur-press) ease-out hover:bg-(image:--button-secondary-hover) active:scale-[0.97]";

export const EntityChip = ({ entity }: { entity: EntityRef }) => {
  const { taskDone, toggleTask, openEntity } = use(NotesContext);
  if (entity.kind === "task") {
    const task = TASKS[entity.id];
    const done = taskDone(entity.id);
    return (
      <span className={cn(CHIP, "pr-0.5 pl-[3px]")}>
        <TaskCheckbox checked={done} onCheckedChange={() => toggleTask(entity.id)} label={`Complete ${task.title}`} />
        <button type="button" onClick={() => openEntity(entity)} className={cn("flex h-6 min-w-0 items-center rounded-full pr-2", CHIP_PRESS)}>
          <StrikeTitle struck={done}>{task.title}</StrikeTitle>
        </button>
      </span>
    );
  }
  if (entity.kind === "project") {
    const project = PROJECTS[entity.id];
    return (
      <button type="button" onClick={() => openEntity(entity)} className={cn(CHIP, CHIP_PRESS, "pr-2.5 pl-1")}>
        <ProgressPie value={project.progress} colour={areaVar(AREAS[project.area].colour)} />
        <span className="truncate">{project.title}</span>
      </button>
    );
  }
  const area = AREAS[entity.id];
  return (
    <button type="button" onClick={() => openEntity(entity)} className={cn(CHIP, CHIP_PRESS, "px-2.5")}>
      <AreaDot colour={area.colour} />
      <span className="truncate">{area.name}</span>
    </button>
  );
};

export const LabelPill = ({ name, className }: { name: string; className?: string }) => {
  const label = LABELS.find((candidate) => candidate.name === name);
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2 align-middle text-micro font-medium text-muted-foreground", className)}>
      {label && <AreaDot colour={label.colour} className="size-1.5" />}
      {name}
    </span>
  );
};

const Mark = ({ children }: { children: ReactNode }) => (
  <span aria-hidden="true" className="font-mono text-[0.8125em] text-faint-foreground">
    {children}
  </span>
);

export const WikiLink = ({ id, alias, raw = false }: { id: NoteId; alias?: string | undefined; raw?: boolean }) => {
  const { openNote } = use(NotesContext);
  return (
    <>
      {raw && <Mark>[[</Mark>}
      <button
        type="button"
        onClick={() => openNote(id)}
        className="rounded-[4px] text-left text-brand decoration-brand/40 underline-offset-[3px] hover:underline"
      >
        {alias ?? titleOf(id)}
      </button>
      {raw && <Mark>]]</Mark>}
    </>
  );
};

export const Inlines = ({ inlines, raw = false }: { inlines: Inline[]; raw?: boolean }) => (
  <>
    {inlines.map((inline, index) => {
      if (typeof inline === "string") return <span key={index}>{inline}</span>;
      if (inline.kind === "strong")
        return (
          <strong key={index} className="font-semibold">
            {raw && <Mark>**</Mark>}
            {inline.text}
            {raw && <Mark>**</Mark>}
          </strong>
        );
      if (inline.kind === "code")
        return (
          <code key={index} className="rounded-[5px] bg-foreground/[0.06] px-1 py-px font-mono text-[0.875em]">
            {inline.text}
          </code>
        );
      if (inline.kind === "note") return <WikiLink key={index} id={inline.id} alias={inline.alias} raw={raw} />;
      if (inline.kind === "missing")
        return (
          <span key={index} title="Not created yet" className="text-brand/70 underline decoration-brand/35 decoration-dashed underline-offset-[3px]">
            {inline.title}
          </span>
        );
      if (inline.kind === "entity") return <EntityChip key={index} entity={inline.ref} />;
      if (inline.kind === "label") return <LabelPill key={index} name={inline.name} className="mx-0.5 -translate-y-px" />;
      return (
        <a key={index} href={inline.href} className="text-brand decoration-brand/40 underline-offset-[3px] hover:underline">
          {inline.text}
        </a>
      );
    })}
  </>
);

export const Caret = () => (
  <span aria-hidden="true" className="ml-px inline-block h-[1.15em] w-0.5 translate-y-[0.2em] animate-pending rounded-full bg-brand motion-reduce:animate-none" />
);

const CALLOUTS: Record<CalloutTone, { icon: Icon; colour: string }> = {
  note: { icon: Info, colour: "var(--brand)" },
  idea: { icon: Lightbulb, colour: "var(--positive)" },
  question: { icon: Question, colour: "var(--area-plum)" },
  warning: { icon: Warning, colour: "var(--negative)" },
};

export const Callout = ({ tone, title, children }: { tone: CalloutTone; title: string; children: ReactNode }) => {
  const { icon: ToneIcon, colour } = CALLOUTS[tone];
  return (
    <aside className="rounded-xl px-4 py-3.5" style={{ backgroundColor: `color-mix(in oklab, ${colour} 11%, transparent)` }}>
      <p className="flex items-center gap-2 font-medium">
        <ToneIcon weight="fill" className="size-4 shrink-0" style={{ color: colour }} aria-hidden="true" />
        {title}
      </p>
      <div className="mt-1 pl-6 text-foreground/80">{children}</div>
    </aside>
  );
};

const CODE_WORDS = /(\b(?:def|return|import|from|for|in|if|else)\b)/;

export const CodeBlock = ({ language, lines }: { language: string; lines: string[] }) => (
  <div className="relative rounded-xl bg-foreground/[0.04]">
    <Tag className="absolute top-2.5 right-2.5">{language}</Tag>
    <pre className="overflow-x-auto px-4 py-3.5 @max-md:pt-9 font-mono text-[0.8125rem] leading-[1.375rem] text-foreground/85">
      {lines.map((line, index) => (
        <span key={index} className="block">
          {line.split(CODE_WORDS).map((part, at) =>
            CODE_WORDS.test(part) ? (
              <span key={at} className="text-brand">
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </span>
      ))}
    </pre>
  </div>
);

export const NoteTable = ({ head, rows, figures }: { head: string[]; rows: string[][]; figures: number[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full border-separate border-spacing-0 text-small">
      <thead>
        <tr>
          {head.map((cell, column) => (
            <th key={cell} scope="col" className={cn("px-3 pb-1.5 @max-md:px-2 font-medium text-muted-foreground", figures.includes(column) ? "text-right" : "text-left")}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row[0]} className="group/row">
            {row.map((cell, column) => (
              <td
                key={column}
                className={cn(
                  "bg-foreground/[0.035] px-3 py-2 @max-md:px-2 whitespace-nowrap transition-colors duration-(--dur-fast) group-hover/row:bg-foreground/[0.06]",
                  figures.includes(column) && "text-right font-mono",
                  at === 0 && "first:rounded-tl-xl last:rounded-tr-xl",
                  at === rows.length - 1 && "first:rounded-bl-xl last:rounded-br-xl",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const TodoLine = ({
  todo,
  done,
  onToggle,
  onMakeTask,
  raw = false,
  caret = false,
  toolAlways = false,
}: {
  todo: Todo;
  done: boolean;
  onToggle: () => void;
  onMakeTask?: (() => void) | undefined;
  raw?: boolean;
  caret?: boolean;
  toolAlways?: boolean;
}) => {
  const isTask = todo.task !== undefined;
  const task = todo.task ? TASKS[todo.task] : undefined;
  return (
    <li className="group/todo relative flex items-start gap-2.5">
      <span className="grid h-[1lh] shrink-0 place-items-center">
        <TaskCheckbox
          checked={done}
          onCheckedChange={onToggle}
          label={`${isTask ? "Complete" : "Tick"} ${todo.text.map((inline) => (typeof inline === "string" ? inline : "")).join("")}`}
          className={cn("transition-[transform,border-radius] duration-(--dur-base)", isTask ? "rounded-[6px]" : "rounded-full")}
        />
      </span>
      <span className={cn("min-w-0 flex-1 transition-colors duration-(--dur-slow) ease-out", done && "text-faint-foreground line-through decoration-faint-foreground/60")}>
        <Inlines inlines={todo.text} raw={raw} />
        {caret && <Caret />}
        {task && (
          <span className="ml-2 inline-flex animate-fade-in items-center gap-1.5 align-middle text-small text-muted-foreground no-underline">
            <AreaDot colour={AREAS[task.area].colour} />
            {task.project ? PROJECTS[task.project].title : AREAS[task.area].name}
          </span>
        )}
      </span>
      {onMakeTask && !isTask && !done && (
        <button
          type="button"
          onClick={onMakeTask}
          className={cn(
            "inline-flex h-[1lh] shrink-0 items-center gap-1 rounded-full px-2 text-small text-muted-foreground transition-[opacity,background-color,color,scale] duration-(--dur-fast) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.96]",
            !toolAlways && "opacity-0 group-hover/todo:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <ArrowBendUpRight weight="bold" className="size-3.5" aria-hidden="true" />
          Make Task
        </button>
      )}
    </li>
  );
};

type EditorState = {
  active?: number | undefined;
  onActivate?: ((index: number) => void) | undefined;
  todoDone: (id: string) => boolean;
  onToggleTodo: (id: string) => void;
  onMakeTask?: ((id: string) => void) | undefined;
  taskFor?: ((id: string) => TaskId | undefined) | undefined;
};

const BLOCK_GAP: Record<Block["kind"], string> = {
  heading: "mt-8",
  paragraph: "mt-4",
  bullets: "mt-3",
  todos: "mt-3",
  quote: "mt-5",
  code: "mt-5",
  callout: "mt-5",
  table: "mt-5",
  image: "mt-6",
  rule: "mt-8",
};

const HEADING_MARK = { 1: "#", 2: "##", 3: "###" } as const;

const GutterMark = ({ children }: { children: ReactNode }) => (
  <span aria-hidden="true" className="absolute top-0 right-full mr-7 font-mono text-micro leading-[inherit] whitespace-nowrap text-faint-foreground @max-2xl:hidden">
    {children}
  </span>
);

const BlockBody = ({ block, size, raw, editor }: { block: Block; size: ProseSize; raw: boolean; editor: EditorState }) => {
  const type = NOTE_TYPE[size];
  if (block.kind === "heading") {
    const Heading = `h${block.level + 1}` as "h2" | "h3" | "h4";
    return (
      <Heading className={cn("relative text-pretty", type.headings[block.level])}>
        {raw && <GutterMark>{HEADING_MARK[block.level]}</GutterMark>}
        <Inlines inlines={block.text} raw={raw} />
        {raw && <Caret />}
      </Heading>
    );
  }
  if (block.kind === "paragraph")
    return (
      <p className="text-pretty">
        <Inlines inlines={block.text} raw={raw} />
        {raw && <Caret />}
      </p>
    );
  if (block.kind === "bullets")
    return (
      <ul className="space-y-1">
        {block.items.map((item, index) => (
          <li key={index} className="flex items-start gap-2.5">
            <span aria-hidden="true" className="grid h-[1lh] w-[18px] shrink-0 place-items-center">
              <span className="size-[5px] rounded-full bg-foreground/45" />
            </span>
            <span className="min-w-0 flex-1 text-pretty">
              <Inlines inlines={item} raw={raw} />
              {raw && index === block.items.length - 1 && <Caret />}
            </span>
          </li>
        ))}
      </ul>
    );
  if (block.kind === "todos")
    return (
      <ul className="space-y-1">
        {block.items.map((item, index) => {
          const taskId = item.task ?? editor.taskFor?.(item.id);
          return (
            <TodoLine
              key={item.id}
              todo={taskId ? { ...item, task: taskId } : item}
              done={editor.todoDone(item.id)}
              onToggle={() => editor.onToggleTodo(item.id)}
              onMakeTask={editor.onMakeTask ? () => editor.onMakeTask?.(item.id) : undefined}
              raw={raw}
              caret={raw && index === block.items.length - 1}
            />
          );
        })}
      </ul>
    );
  if (block.kind === "quote")
    return (
      <blockquote className="relative pl-5 before:absolute before:inset-y-0.5 before:left-0 before:w-[3px] before:rounded-full before:bg-foreground/15">
        {raw && <GutterMark>&gt;</GutterMark>}
        <p className="text-pretty text-foreground/80">
          <Inlines inlines={block.text} raw={raw} />
          {raw && <Caret />}
        </p>
        {block.cite && (
          <footer className="mt-1 text-small text-muted-foreground">
            <Inlines inlines={block.cite} />
          </footer>
        )}
      </blockquote>
    );
  if (block.kind === "code") return <CodeBlock language={block.language} lines={block.lines} />;
  if (block.kind === "callout")
    return (
      <Callout tone={block.tone} title={block.title}>
        <p className="text-pretty">
          <Inlines inlines={block.text} raw={raw} />
        </p>
      </Callout>
    );
  if (block.kind === "table") return <NoteTable head={block.head} rows={block.rows} figures={block.figures} />;
  if (block.kind === "image")
    return (
      <figure>
        <img
          src={block.src}
          alt={block.alt}
          width={1536}
          height={1024}
          loading="lazy"
          draggable={false}
          className="aspect-[3/2] w-full rounded-xl object-cover outline-1 -outline-offset-1 outline-foreground/[0.06]"
        />
        <figcaption className="mt-2 text-center text-small text-muted-foreground">{block.caption}</figcaption>
      </figure>
    );
  return <hr className="border-0 border-t border-border" />;
};

export const NoteProse = ({
  blocks,
  size = "reading",
  editor,
  className,
}: {
  blocks: Block[];
  size?: ProseSize;
  editor: EditorState;
  className?: string;
}) => (
  <div className={cn("select-text", NOTE_TYPE[size].body, className)}>
    {blocks.map((block, index) => {
      const active = editor.active === index;
      return (
        <div
          key={index}
          data-heading={block.kind === "heading" ? "" : undefined}
          onPointerDown={editor.onActivate ? () => editor.onActivate?.(index) : undefined}
          className={cn(
            "relative first:mt-0 [[data-heading]+&]:mt-2",
            BLOCK_GAP[block.kind],
            "before:pointer-events-none before:absolute before:inset-y-0.5 before:-left-4 before:w-1 before:rounded-full before:bg-foreground/[0.14] before:transition-opacity before:duration-(--dur-fast)",
            active ? "before:opacity-100" : "before:opacity-0",
          )}
        >
          <BlockBody block={block} size={size} raw={active} editor={editor} />
        </div>
      );
    })}
  </div>
);

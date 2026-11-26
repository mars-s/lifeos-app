"use client";

import { Plus } from "@phosphor-icons/react";
import { use, useState } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { AreaDot, areaVar } from "@/components/lifeos/area";
import { round } from "@/components/lifeos/format";
import { StrikeTitle, TaskCheckbox } from "@/components/lifeos/task-row";
import { cn } from "@/lib/utils";
import { backlinksOf, linksOut, NOTE_IDS, type EntityRef, type NoteId } from "./model";
import { EntityChip, NotesContext } from "./prose";
import { AREAS, areaOf, NOTES, PROJECTS, TASKS, tasksMentioning, titleOf } from "./sample";

type NodeShape = "note" | "current" | "task" | "project" | "missing";
type LabelSide = "left" | "right" | "above" | "below";
type GraphNode = { key: string; x: number; y: number; r: number; colour: string; shape: NodeShape; label: string; side: LabelSide; note?: NoteId };
type GraphEdge = { from: string; to: string };

const NEUTRAL = "var(--muted-foreground)";
const noteColour = (id: NoteId) => {
  const area = areaOf(id);
  return area ? areaVar(area.colour) : NEUTRAL;
};
const short = (text: string, max = 22) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const labelAt = (node: GraphNode) => {
  const gap = node.r + 5;
  if (node.side === "right") return { x: node.x + gap, y: node.y + 3, anchor: "start" } as const;
  if (node.side === "left") return { x: node.x - gap, y: node.y + 3, anchor: "end" } as const;
  if (node.side === "above") return { x: node.x, y: node.y - gap, anchor: "middle" } as const;
  return { x: node.x, y: node.y + gap + 7, anchor: "middle" } as const;
};

const NodeGlyph = ({ node }: { node: GraphNode }) => {
  if (node.shape === "task")
    return <rect x={node.x - node.r} y={node.y - node.r} width={node.r * 2} height={node.r * 2} rx={1.75} fill="none" stroke={node.colour} strokeWidth={1.5} />;
  if (node.shape === "project")
    return (
      <>
        <circle cx={node.x} cy={node.y} r={node.r} fill="none" stroke={node.colour} strokeWidth={1.5} />
        <circle cx={node.x} cy={node.y} r={node.r - 2.75} fill={node.colour} />
      </>
    );
  if (node.shape === "missing") return <circle cx={node.x} cy={node.y} r={node.r} fill="none" stroke="var(--faint-foreground)" strokeWidth={1.25} strokeDasharray="2 2" />;
  if (node.shape === "current")
    return (
      <>
        <circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="var(--brand)" strokeWidth={1.5} opacity={0.45} />
        <circle cx={node.x} cy={node.y} r={node.r} fill="var(--brand)" />
      </>
    );
  return <circle cx={node.x} cy={node.y} r={node.r} fill={node.colour} />;
};

const Graph = ({
  nodes,
  edges,
  width,
  height,
  label,
  labels = "all",
  className,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  label: string;
  labels?: "all" | "hover";
  className?: string;
}) => {
  const { openNote } = use(NotesContext);
  const [hover, setHover] = useState<string | null>(null);
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const near = (key: string) => hover === null || key === hover || edges.some((edge) => (edge.from === hover && edge.to === key) || (edge.to === hover && edge.from === key));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} className={cn("w-full shrink-0 select-none", className)} style={{ aspectRatio: `${width} / ${height}` }}>
      {edges.map((edge) => {
        const from = byKey.get(edge.from);
        const to = byKey.get(edge.to);
        if (!from || !to) return null;
        const lit = hover !== null && (edge.from === hover || edge.to === hover);
        return (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={1}
            strokeLinecap="round"
            className={cn("transition-[stroke,opacity] duration-(--dur-fast) ease-out", lit ? "stroke-foreground/45" : "stroke-foreground/[0.13]")}
            opacity={hover === null || lit ? 1 : 0.35}
          />
        );
      })}
      {nodes.map((node) => {
        const text = labelAt(node);
        const shown = labels === "all" || hover === node.key || (hover !== null && near(node.key) && node.shape !== "current");
        return (
          <g
            key={node.key}
            role={node.note ? "button" : undefined}
            tabIndex={node.note ? 0 : undefined}
            aria-label={node.label}
            onPointerEnter={() => setHover(node.key)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(node.key)}
            onBlur={() => setHover(null)}
            onClick={node.note ? () => openNote(node.note!) : undefined}
            onKeyDown={node.note ? (event) => (event.key === "Enter" || event.key === " " ? openNote(node.note!) : undefined) : undefined}
            className={cn("outline-none transition-opacity duration-(--dur-fast) ease-out [&:focus-visible>circle:first-of-type]:stroke-ring", node.note && "cursor-pointer")}
            opacity={near(node.key) ? 1 : 0.3}
          >
            <circle cx={node.x} cy={node.y} r={Math.max(12, node.r + 6)} fill="transparent" strokeWidth={2} />
            <NodeGlyph node={node} />
            <text
              x={text.x}
              y={text.y}
              textAnchor={text.anchor}
              className={cn(
                "pointer-events-none text-[9.5px] transition-opacity duration-(--dur-fast) ease-out",
                node.shape === "current" ? "fill-foreground font-medium" : "fill-muted-foreground",
                shown ? "opacity-100" : "opacity-0",
              )}
            >
              {short(node.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const entityKey = (ref: EntityRef) => `${ref.kind}:${ref.id}`;
const entityNode = (ref: EntityRef) => {
  if (ref.kind === "task") return { label: TASKS[ref.id].title, colour: areaVar(AREAS[TASKS[ref.id].area].colour), shape: "task" as const };
  if (ref.kind === "project") return { label: PROJECTS[ref.id].title, colour: areaVar(AREAS[PROJECTS[ref.id].area].colour), shape: "project" as const };
  return { label: AREAS[ref.id].name, colour: areaVar(AREAS[ref.id].colour), shape: "note" as const };
};

const LOCAL = { width: 264, height: 196, rx: 76, ry: 64 } as const;

const sideFor = (angle: number) => {
  const cos = Math.cos(angle);
  const side: LabelSide = cos > 0.35 ? "right" : cos < -0.35 ? "left" : Math.sin(angle) < 0 ? "above" : "below";
  return side;
};

export const LocalGraph = ({ id, className }: { id: NoteId; className?: string }) => {
  const out = linksOut(NOTES[id]);
  const back = backlinksOf(id, NOTES).map((link) => link.from);
  const noteIds = [...new Set([...out.notes, ...back])];
  const around: Omit<GraphNode, "x" | "y" | "side">[] = [
    ...noteIds.map((note) => ({ key: note, r: 3 + Math.min(3, backlinksOf(note, NOTES).length * 0.75), colour: noteColour(note), shape: "note" as const, label: titleOf(note), note })),
    ...out.entities.map((ref) => ({ key: entityKey(ref), r: 4, ...entityNode(ref) })),
    ...out.missing.map((title) => ({ key: `missing:${title}`, r: 3.5, colour: NEUTRAL, shape: "missing" as const, label: title })),
  ];
  const centre: GraphNode = { key: id, x: LOCAL.width / 2, y: LOCAL.height / 2, r: 5.5, colour: "var(--brand)", shape: "current", label: titleOf(id), side: "below" };
  const ring = around.map((node, index) => {
    const angle = -Math.PI / 2 + ((index + 0.5) / around.length) * Math.PI * 2;
    const reach = index % 2 === 0 ? 1 : 0.78;
    return { ...node, x: round(centre.x + Math.cos(angle) * LOCAL.rx * reach), y: round(centre.y + Math.sin(angle) * LOCAL.ry * reach), side: sideFor(angle) } satisfies GraphNode;
  });
  const between = noteIds.flatMap((from) => linksOut(NOTES[from]).notes.filter((to) => to !== id && noteIds.includes(to)).map((to) => ({ from, to })));
  const edges = [...ring.map((node) => ({ from: id, to: node.key })), ...between];
  return <Graph nodes={[...ring, centre]} edges={edges} width={LOCAL.width} height={LOCAL.height} label={`Notes linked with ${titleOf(id)}`} labels="hover" {...(className ? { className } : {})} />;
};

const VAULT_AT: Record<NoteId, { x: number; y: number; side: LabelSide }> = {
  retrieval: { x: 268, y: 232, side: "below" },
  outline: { x: 160, y: 158, side: "left" },
  "dense-sparse": { x: 172, y: 322, side: "left" },
  supervision: { x: 318, y: 112, side: "right" },
  evaluation: { x: 366, y: 334, side: "right" },
  "day-19": { x: 410, y: 204, side: "right" },
  "day-18": { x: 84, y: 84, side: "right" },
  "day-17": { x: 404, y: 44, side: "right" },
  japan: { x: 548, y: 96, side: "below" },
  "reading-list": { x: 618, y: 40, side: "left" },
  copy: { x: 536, y: 300, side: "left" },
  pricing: { x: 606, y: 226, side: "above" },
  sds: { x: 486, y: 404, side: "right" },
};

export const VaultGraph = ({ current, className }: { current: NoteId; className?: string }) => {
  const nodes = NOTE_IDS.map((id) => {
    const degree = backlinksOf(id, NOTES).length + linksOut(NOTES[id]).notes.length;
    return { key: id, ...VAULT_AT[id], r: round(3 + Math.min(4, degree * 0.6)), colour: noteColour(id), shape: id === current ? "current" : "note", label: titleOf(id), note: id } satisfies GraphNode;
  });
  const edges = NOTE_IDS.flatMap((from) => linksOut(NOTES[from]).notes.map((to) => ({ from, to })));
  return <Graph nodes={nodes} edges={edges} width={680} height={440} label="Every note and its links" {...(className ? { className } : {})} />;
};

export const GraphLegend = () => (
  <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-micro text-muted-foreground">
    {(Object.keys(AREAS) as (keyof typeof AREAS)[]).map((id) => (
      <li key={id} className="flex items-center gap-1.5">
        <AreaDot colour={AREAS[id].colour} className="size-1.5" />
        {AREAS[id].name}
      </li>
    ))}
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />
      Journal and unfiled
    </li>
  </ul>
);

const PanelHeading = ({ children, count }: { children: string; count: number }) => (
  <h4 className="flex h-7 items-center gap-1.5 px-2 text-micro font-medium text-faint-foreground">
    {children}
    <RollingNumber value={count} className="font-mono" />
  </h4>
);

const PanelRow = ({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="block w-full rounded-lg px-2 py-1.5 text-left transition-[background-color,scale] duration-(--dur-press) ease-out hover:bg-foreground/[0.04] active:scale-[0.985]"
  >
    {children}
  </button>
);

export const Backlinks = ({ id }: { id: NoteId }) => {
  const { openNote, taskDone, toggleTask, openEntity } = use(NotesContext);
  const back = backlinksOf(id, NOTES);
  const tasks = tasksMentioning(id);
  return (
    <section aria-label="Linked from">
      {tasks.length > 0 && (
        <>
          <PanelHeading count={tasks.length}>Tasks</PanelHeading>
          <ul className="mb-2">
            {tasks.map((task) => (
              <li key={task} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                <TaskCheckbox checked={taskDone(task)} onCheckedChange={() => toggleTask(task)} label={`Complete ${TASKS[task].title}`} />
                <button type="button" onClick={() => openEntity({ kind: "task", id: task })} className="min-w-0 flex-1 truncate rounded-[4px] text-left text-small">
                  <StrikeTitle struck={taskDone(task)}>{TASKS[task].title}</StrikeTitle>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <PanelHeading count={back.length}>Linked from</PanelHeading>
      {back.length === 0 && <p className="px-2 pb-2 text-small text-pretty text-muted-foreground">Nothing links here yet. Type [[ in another note to connect it.</p>}
      <ul>
        {back.map((link) => {
          const area = areaOf(link.from);
          return (
            <li key={link.from}>
              <PanelRow onClick={() => openNote(link.from)}>
                <span className="flex items-center gap-2 text-small font-medium">
                  <span className="min-w-0 flex-1 truncate">{titleOf(link.from)}</span>
                  {area && <AreaDot colour={area.colour} className="size-1.5" />}
                </span>
                <span className="mt-0.5 line-clamp-2 text-micro text-pretty text-muted-foreground">
                  {link.context.map((inline, index) =>
                    typeof inline === "string" ? (
                      inline
                    ) : inline.kind === "note" ? (
                      <span key={index} className={cn(inline.id === id && "font-medium text-foreground/85")}>
                        {inline.alias ?? titleOf(inline.id)}
                      </span>
                    ) : inline.kind === "strong" || inline.kind === "code" ? (
                      inline.text
                    ) : null,
                  )}
                </span>
              </PanelRow>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const OutgoingLinks = ({ id, onCreate }: { id: NoteId; onCreate?: (title: string) => void }) => {
  const { openNote } = use(NotesContext);
  const out = linksOut(NOTES[id]);
  const count = out.notes.length + out.entities.length + out.missing.length;
  return (
    <section aria-label="Links out">
      <PanelHeading count={count}>Links out</PanelHeading>
      {count === 0 && <p className="px-2 pb-2 text-small text-pretty text-muted-foreground">This note does not link anywhere yet.</p>}
      <ul>
        {out.notes.map((note) => {
          const area = areaOf(note);
          return (
            <li key={note}>
              <PanelRow onClick={() => openNote(note)}>
                <span className="flex items-center gap-2 text-small">
                  <span className="min-w-0 flex-1 truncate">{titleOf(note)}</span>
                  {area && <AreaDot colour={area.colour} className="size-1.5" />}
                </span>
              </PanelRow>
            </li>
          );
        })}
        {out.entities.length > 0 && (
          <li className="flex flex-wrap gap-y-1.5 px-1.5 py-1.5">
            {out.entities.map((ref) => (
              <EntityChip key={entityKey(ref)} entity={ref} />
            ))}
          </li>
        )}
        {out.missing.map((title) => (
          <li key={title}>
            <PanelRow {...(onCreate ? { onClick: () => onCreate(title) } : {})}>
              <span className="flex items-center gap-2 text-small text-muted-foreground">
                <span className="min-w-0 flex-1 truncate underline decoration-foreground/25 decoration-dashed underline-offset-[3px]">{title}</span>
                <span className="inline-flex items-center gap-1 text-micro text-faint-foreground">
                  <Plus weight="bold" className="size-3" aria-hidden="true" />
                  Create
                </span>
              </span>
            </PanelRow>
          </li>
        ))}
      </ul>
    </section>
  );
};

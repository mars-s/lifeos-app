"use client";

import { FrameCorners, Note as NoteIcon, CheckSquare, TextT } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/action-button";
import { toast } from "@/components/ui/toast-stack";
import { AreaDot } from "@/components/lifeos/area";
import { cn } from "@/lib/utils";
import { GLASS } from "../notes/parts";
import { AREAS } from "../notes/sample";
import { PlainCard } from "./cards";
import { NOTES_BOARD } from "./sample";
import { Stage } from "./stage";

const TOOLS = [
  { name: "Note", icon: NoteIcon, says: "Pick a note, or start a new one, and it lands where you are looking" },
  { name: "Text", icon: TextT, says: "A line of text that lives only on this canvas" },
  { name: "Task", icon: CheckSquare, says: "Pick a Task. Its checkbox is the real one" },
  { name: "Group", icon: FrameCorners, says: "Drag a frame around cards to keep them together" },
] as const;

export const NotesCanvas = () => {
  const [selected, setSelected] = useState<string | null>("dense");
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setDone((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <Stage
      label="Canvas: Thesis map"
      size={NOTES_BOARD}
      cards={NOTES_BOARD.cards}
      edges={NOTES_BOARD.edges}
      focus={{ x: 420, y: 200 }}
      movable
      overlay={
        <>
          <p data-still className={cn("absolute top-3 left-3 z-30 flex h-8 items-center gap-2 rounded-full px-3 text-small", GLASS)}>
            <AreaDot colour={AREAS.university.colour} />
            <span className="font-medium">Thesis map</span>
            <span className="font-mono text-micro text-muted-foreground tabular-nums">8 cards, 6 links</span>
          </p>
          <div data-still role="toolbar" aria-label="Add to the canvas" className={cn("absolute bottom-3 left-3 z-30 flex items-center rounded-full p-0.5", GLASS)}>
            {TOOLS.map((tool) => (
              <Button key={tool.name} variant="quiet" icon={tool.icon} onClick={() => toast(tool.says, { id: "canvas-tool" })}>
                {tool.name}
              </Button>
            ))}
          </div>
        </>
      }
    >
      {(card) => <PlainCard card={card} act={{ selected, onSelect: setSelected, done, onToggle: toggle }} />}
    </Stage>
  );
};

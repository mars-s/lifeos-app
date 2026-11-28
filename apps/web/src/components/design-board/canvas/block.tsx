"use client";

import { useEffect, useRef, useState } from "react";
import { Tag } from "@/components/ui/status-pill";
import { AiMark } from "@/components/lifeos/ai-orb";
import { idleStatus, StepView, WiredCard } from "./cards";
import type { StepStatus } from "./model";
import { BLOCK_BOARD, POSTER_TIMES } from "./sample";
import { Stage } from "./stage";

const BLOCK_TOKENS = `
:root { color-scheme: light dark; --paper: light-dark(oklch(1 0 0), oklch(0.285 0.006 264)); --ink: light-dark(oklch(0.265 0.008 70), oklch(0.93 0.004 264)); --quiet: light-dark(oklch(0.5 0.01 75), oklch(0.69 0.006 264)); }
* { box-sizing: border-box; margin: 0; }
body { background: var(--paper); color: var(--ink); font: 13px/20px system-ui, sans-serif; padding: 4px; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
`;

const BLOCK_STYLE = `
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.still { display: grid; gap: 4px; border-radius: 8px; text-align: left; transition: scale 120ms ease-out; }
.still:active { scale: 0.97; }
.frame { position: relative; aspect-ratio: 16 / 9; border-radius: 6px; background: oklch(0.955 0.012 85); overflow: hidden; }
.frame i { position: absolute; left: 10%; height: 9%; border-radius: 99px; background: oklch(0.27 0.008 70); }
.frame b { position: absolute; right: 10%; bottom: 16%; width: 14%; border-radius: 2px; background: oklch(0.27 0.008 70); }
.still[aria-pressed="true"] .frame { outline: 2px solid var(--ink); outline-offset: 2px; }
.time { font: 11px/16px ui-monospace, monospace; color: var(--quiet); font-variant-numeric: tabular-nums; }
.still[aria-pressed="true"] .time { color: var(--ink); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .still { transition: none; } }
`;

const BLOCK_SCRIPT = `
const times = ${JSON.stringify(POSTER_TIMES)};
const grid = document.querySelector(".grid");
let picked = times[2];
const pick = (time) => {
  picked = time;
  for (const node of grid.children) node.setAttribute("aria-pressed", String(Number(node.dataset.time) === time));
  parent.postMessage({ lifeosBlock: 1, output: "time", value: time }, "*");
};
times.forEach((time, index) => {
  const still = document.createElement("button");
  still.className = "still";
  still.type = "button";
  still.dataset.time = String(time);
  still.setAttribute("aria-label", "Use the frame at " + time + " seconds");
  const part = time / 40;
  still.innerHTML = '<span class="frame">' + [0, 1, 2].map((row) => '<i style="top:' + (24 + row * 20) + '%;width:' + (28 + ((index * 17 + row * 23) % 34)) + '%;opacity:' + (row === 0 ? 1 : 0.35) + '"></i>').join("") + '<b style="height:' + Math.round(12 + part * 56) + '%"></b></span><span class="time">' + time.toFixed(1) + ' s</span>';
  still.addEventListener("click", () => pick(time));
  grid.append(still);
});
addEventListener("message", (event) => { if (event.source === parent && event.data && event.data.lifeosHost) pick(picked); });
pick(picked);
`;

const BLOCK_DOC = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>Pick the poster</title><style>${BLOCK_TOKENS}${BLOCK_STYLE}</style></head><body><div class="grid"></div><script>${BLOCK_SCRIPT}</script></body></html>`;

const readTime = (data: unknown) => {
  if (typeof data !== "object" || data === null) return undefined;
  if (!("lifeosBlock" in data) || !("output" in data) || !("value" in data)) return undefined;
  return data.output === "time" && typeof data.value === "number" && Number.isFinite(data.value) ? data.value : undefined;
};

export const BlockCanvas = () => {
  const frame = useRef<HTMLIFrameElement>(null);
  const [time, setTime] = useState<number | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const value = readTime(event.data);
      if (value !== undefined) setTime(value);
    };
    window.addEventListener("message", onMessage);
    frame.current?.contentWindow?.postMessage({ lifeosHost: 1 }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const status: Record<string, StepStatus> = { assemble: { state: "done", words: "Done in 14 s" } };
  const picked = time === null ? "time" : time.toFixed(1);

  return (
    <Stage label="Canvas: a custom block" size={BLOCK_BOARD} cards={BLOCK_BOARD.cards} edges={BLOCK_BOARD.edges} focus={{ x: 490, y: 180 }}>
      {(card) => {
        if (card.kind === "step") return <StepView step={card} status={status[card.id] ?? idleStatus(card)} values={{ time: picked }} />;
        if (card.kind !== "block") return null;
        return (
          <WiredCard
            card={card}
            title={card.title}
            mark={<AiMark className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            aside={<Tag>Made for this canvas</Tag>}
            footer={<p className="px-3 pt-1 pb-2.5 text-micro text-pretty text-faint-foreground">Sealed. It can read its sockets and set its outputs, nothing else.</p>}
          >
            <iframe ref={frame} title="Pick the poster frame" sandbox="allow-scripts" srcDoc={BLOCK_DOC} className="size-full rounded-lg" />
          </WiredCard>
        );
      }}
    </Stage>
  );
};

export const LINE = [
  {
    name: "LifeOS parts",
    when: "First choice",
    points: ["A fixed set LifeOS draws: Task tile, day meter, table, number, text, image, video still", "The AI sends data, never code", "Works on web, Mac and iPhone, offline, in both themes"],
  },
  {
    name: "A custom block",
    when: "When no part fits",
    points: ["HTML the AI wrote, in a sealed frame with no network", "Talks to the canvas only through its sockets", "Cannot see Tasks, notes, your sign-in or the Mac"],
  },
];

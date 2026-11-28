"use client";

import { Laptop } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/action-button";
import { cn } from "@/lib/utils";
import { GLASS } from "../notes/parts";
import { idleStatus, StepView, WiredCard } from "./cards";
import type { StepStatus } from "./model";
import { FRAME_COUNT, FRAME_START, RUN_BOARD, RUN_LOG, RUN_STATUS, SCENES } from "./sample";
import { Stage } from "./stage";

const SECONDS_A_FRAME = 0.61;

const sceneAt = (frame: number) => {
  const index = SCENES.findIndex((scene) => frame <= scene.until);
  const at = index < 0 ? SCENES.length - 1 : index;
  const from = SCENES[at - 1]?.until ?? 0;
  const until = SCENES[at]?.until ?? FRAME_COUNT;
  return { index: at, name: SCENES[at]?.name ?? "", progress: (frame - from) / (until - from) };
};

const FILM_ROWS = [0.72, 0.5, 0.64, 0.42];

export const FilmFrame = ({ frame, className }: { frame: number; className?: string }) => {
  const scene = sceneAt(frame);
  return (
    <div role="img" aria-label={`Frame ${frame}, scene ${scene.name}`} className={cn("relative aspect-video overflow-hidden rounded-lg bg-[oklch(0.955_0.012_85)] text-[oklch(0.27_0.008_70)]", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(circle,oklch(0.27_0.008_70/0.12)_1px,transparent_1.5px)] bg-[size:12px_12px]" />
      <p className="absolute top-[14%] left-[9%] text-[1.375rem] leading-none font-semibold tracking-[-0.03em]">{scene.name}</p>
      <ul className="absolute top-[38%] left-[9%] w-[52%] space-y-[7%]">
        {FILM_ROWS.map((width, index) => {
          const shown = scene.progress > index * 0.16;
          const ticked = scene.progress > 0.3 + index * 0.16;
          return (
            <li key={index} className={cn("flex items-center gap-2 transition-opacity duration-(--dur-fast)", shown ? "opacity-100" : "opacity-0")}>
              <span className={cn("size-2.5 shrink-0 rounded-[3px] border-[1.5px] border-current", ticked && "bg-current")} />
              <span className={cn("h-1.5 rounded-full bg-current", ticked ? "opacity-30" : "opacity-80")} style={{ width: `${width * 100}%` }} />
            </li>
          );
        })}
      </ul>
      <div className="absolute top-[18%] right-[9%] bottom-[18%] flex w-[16%] flex-col-reverse gap-[3px]">
        {Array.from({ length: 10 }, (_, index) => (
          <span key={index} className={cn("flex-1 rounded-[2px] bg-current", frame / FRAME_COUNT > index / 10 ? "opacity-85" : "opacity-10")} />
        ))}
      </div>
    </div>
  );
};

const SceneDots = ({ frame }: { frame: number }) => {
  const here = sceneAt(frame).index;
  return (
    <ol className="flex items-center gap-3 px-1 text-micro text-muted-foreground">
      {SCENES.map((scene, index) => (
        <li key={scene.name} aria-current={index === here ? "step" : undefined} className={cn("flex items-center gap-1.5", index === here && "font-medium text-foreground")}>
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", index < here ? "bg-foreground" : index === here ? "animate-pending bg-foreground motion-reduce:animate-none" : "bg-foreground/[0.15]")} />
          {scene.name}
        </li>
      ))}
    </ol>
  );
};

const pad = (frame: number) => String(frame).padStart(4, "0");

const leftWords = (frame: number) => {
  const seconds = Math.round((FRAME_COUNT - frame) * SECONDS_A_FRAME);
  return seconds >= 90 ? `about ${Math.round(seconds / 60)} min left` : `about ${seconds} s left`;
};

export const RunCanvas = () => {
  const [frame, setFrame] = useState(FRAME_START);
  const [stopped, setStopped] = useState(false);
  const finished = frame >= FRAME_COUNT;
  useEffect(() => {
    if (stopped || finished) return;
    const timer = window.setInterval(() => setFrame((before) => Math.min(FRAME_COUNT, before + 1)), 610);
    return () => window.clearInterval(timer);
  }, [stopped, finished]);

  const framesStatus: StepStatus = finished
    ? { state: "done", words: `Done. ${FRAME_COUNT} frames`, done: FRAME_COUNT, of: FRAME_COUNT }
    : stopped
      ? { state: "failed", words: `Stopped at frame ${frame}. Its frames are kept`, done: frame, of: FRAME_COUNT }
      : { state: "running", words: `${frame} of ${FRAME_COUNT} frames, ${SECONDS_A_FRAME} s each`, done: frame, of: FRAME_COUNT };
  const status: Record<string, StepStatus> = { ...RUN_STATUS, frames: framesStatus };
  const running = !stopped && !finished;

  return (
    <Stage
      label="Canvas: Launch film, running"
      size={RUN_BOARD}
      cards={RUN_BOARD.cards}
      edges={RUN_BOARD.edges}
      live={new Set(running ? ["frames-look", "scenes-frames"] : [])}
      focus={{ x: 400, y: 160 }}
      overlay={
        <>
          <div data-still className={cn("absolute bottom-3 left-3 z-30 hidden w-72 rounded-xl px-3 py-2 lg:block", GLASS)}>
            <p className="text-micro text-muted-foreground">Log, Render the frames</p>
            <pre translate="no" className="mt-0.5 font-mono text-[11px] leading-4 text-muted-foreground">
              {RUN_LOG.map((line) => line.replace("{frame}", pad(frame))).join("\n")}
            </pre>
          </div>
          <div data-still role="status" className={cn("absolute bottom-3 left-1/2 z-30 flex h-11 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2.5 rounded-full py-1 pr-1.5 pl-3.5 text-small", GLASS)}>
            <Laptop weight="fill" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 truncate tabular-nums">
              <span className="sr-only">Running on this Mac. </span>
              {finished ? "Frames done. Assemble is next" : stopped ? "Stopped. Nothing is running" : `Frame ${frame} of ${FRAME_COUNT}, ${leftWords(frame)}`}
            </p>
            {running ? (
              <Button variant="danger" onClick={() => setStopped(true)}>
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  if (finished) setFrame(FRAME_START);
                  setStopped(false);
                }}
              >
                {finished ? "Run again" : "Carry on"}
              </Button>
            )}
          </div>
        </>
      }
    >
      {(card) => {
        if (card.kind === "step") return <StepView step={card} status={status[card.id] ?? idleStatus(card)} />;
        if (card.kind !== "view") return null;
        return (
          <WiredCard
            card={card}
            title={card.title}
            aside={<span className="font-mono text-micro text-muted-foreground tabular-nums">{pad(frame)}</span>}
            footer={<p className="px-3 pt-1.5 pb-2.5 text-micro text-pretty text-faint-foreground">A small still goes to your other devices. The frames stay on this Mac.</p>}
          >
            <FilmFrame frame={frame} />
            <div className="pt-2">
              <SceneDots frame={frame} />
            </div>
          </WiredCard>
        );
      }}
    </Stage>
  );
};

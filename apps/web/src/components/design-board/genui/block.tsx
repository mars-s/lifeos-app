"use client";

import interUrl from "@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url";
import monoUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";
import { frameMarkup, parseSpec, readSpec, type UiNode } from "@lifeos/backend/client/genui";
import { ArrowClockwise } from "@phosphor-icons/react";
import { Suspense, use, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { TextMorph } from "torph";
import { AiMark } from "@/components/lifeos/ai-orb";
import { Tag } from "@/components/ui/status-pill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { ThemeContext } from "../theme";
import { GU_CSS, mount, setMorph, type GuHaptic, type GuValue } from "./runtime.js";
import { READ_NAMES, TOOLS } from "./sample";
import { createWorld, type World } from "./world";

const TOKENS = [
  "foreground",
  "muted-foreground",
  "faint-foreground",
  "popover",
  "border",
  "ring",
  "positive",
  "deadline",
  "negative",
  "area-teal",
  "area-rose",
  "area-orange",
  "area-violet",
  "area-green",
  "button",
  "button-hover",
  "button-foreground",
  "button-edge",
  "button-shadow",
  "button-secondary",
  "button-secondary-hover",
] as const;

const POLICY = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";
const RAW = import.meta.glob(["./runtime.js", "../../../../node_modules/torph/dist/index.mjs"], { query: "?raw", import: "default", eager: true });
const RUNTIME = (RAW["./runtime.js"] ?? "").replaceAll(/^export /gm, "");
const TORPH = RAW["../../../../node_modules/torph/dist/index.mjs"] ?? "";
const NO_SOCKETS: readonly string[] = [];
const STREAM_STEP = 14;
const STREAM_MS = 16;
const SHOW_WAIT_MS = 150;

const never = () => () => undefined;
const useInBrowser = () => useSyncExternalStore(never, () => true, () => false);

const asDataUrl = async (url: string) => {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.readAsDataURL(blob);
  });
};

const face = (family: string, data: string) => `@font-face{font-family:"${family}";font-style:normal;font-display:block;font-weight:100 900;src:url(${data}) format("woff2-variations")}`;

let kit: Promise<{ fonts: string; morph: string }> | undefined;
const loadKit = () => {
  kit ??= Promise.all([asDataUrl(interUrl), asDataUrl(monoUrl)]).then(([inter, mono]) => ({
    fonts: face("Inter Variable", inter) + face("Geist Mono Variable", mono),
    morph: `data:text/javascript;base64,${btoa(String.fromCodePoint(...new TextEncoder().encode(TORPH)))}`,
  }));
  return kit;
};

const readTokens = () => {
  const style = getComputedStyle(document.documentElement);
  return TOKENS.map((name) => `--${name}:${style.getPropertyValue(`--${name}`)}`).join(";");
};

const safeJson = (value: unknown) => JSON.stringify(value).replaceAll("<", String.raw`<`);

let styled = false;
const installRuntime = () => {
  if (styled) return;
  styled = true;
  document.head.append(Object.assign(document.createElement("style"), { textContent: GU_CSS }));
  setMorph(TextMorph);
};

type FrameNote = { gu: 1; type: string; height?: number; kind?: GuHaptic; name?: string; value?: GuValue; id?: number; tool?: string; args?: Record<string, GuValue>; from?: string; words?: string };

const readNote = (data: unknown) => (typeof data === "object" && data !== null && "gu" in data && data.gu === 1 && "type" in data && typeof data.type === "string" ? (data as FrameNote) : undefined);

const Wait = ({ lines = 3 }: { lines?: number }) => (
  <div aria-hidden="true" className="gu">
    {Array.from({ length: lines }, (_, index) => (
      <span key={index} className="gu-ghost" style={{ width: `${[68, 92, 54][index % 3]}%`, height: index === 0 ? 28 : 12 }} />
    ))}
  </div>
);

const Sealed = ({ node, world, title }: { node: UiNode; world: World; title: string }) => {
  const theme = useContext(ThemeContext);
  const made = use(loadKit());
  const frame = useRef<HTMLIFrameElement>(null);
  const shade = useRef(theme);
  const [height, setHeight] = useState(Number(node.attrs.h) || 120);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [broken, setBroken] = useState<string>();
  const [doc] = useState(() => {
    const { html, slots } = frameMarkup(node);
    const payload = { slots, tables: world.host.tables, values: world.host.values, waiting: [...world.host.waiting], morph: made.morph };
    return `<!doctype html><html lang="en" style="color-scheme:${document.documentElement.classList.contains("dark") ? "dark" : document.documentElement.classList.contains("light") ? "light" : "light dark"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><title>${title.replaceAll("<", "")}</title><style>${made.fonts}:root{${readTokens()}}html{background:transparent}${GU_CSS}</style></head><body><script>const ui=(()=>{${RUNTIME};return bootFrame(${safeJson(payload)})})();</script>${html}</body></html>`;
  });

  useEffect(() => {
    const post = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ gu: 1, ...message }, "*");
    const leave = world.join({
      setTable: (name, rows) => post({ type: "table", name, rows }),
      setValue: (name, value) => post({ type: "value", name, value }),
    });
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const note = readNote(event.data);
      if (!note) return;
      if (note.type === "ready") {
        setReady(true);
        post({ type: "theme", theme: shade.current });
      }
      if (note.type === "size" && note.height !== undefined) setHeight(note.height);
      if (note.type === "haptic" && note.kind) haptic(note.kind);
      if (note.type === "set" && note.name !== undefined && note.value !== undefined) world.host.out?.(note.name, note.value);
      if (note.type === "read" && note.name && note.from) world.host.read?.(note.name, note.from, {});
      if (note.type === "escape") frame.current?.blur();
      if (note.type === "error") setBroken(note.words);
      if (note.type === "call" && note.tool) {
        const { id } = note;
        Promise.resolve(world.host.call(note.tool, note.args ?? {})).then((ok) => post({ type: "result", id, ok }));
      }
    };
    window.addEventListener("message", onMessage);
    const timer = setTimeout(() => setSlow(true), SHOW_WAIT_MS);
    return () => {
      leave();
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [world]);

  useEffect(() => {
    shade.current = theme;
    frame.current?.contentWindow?.postMessage({ gu: 1, type: "theme", theme }, "*");
  }, [theme]);

  return (
    <div className="relative -m-1" style={{ height: height + 8 }}>
      {!ready && slow && (
        <div className="absolute inset-1">
          <Wait />
        </div>
      )}
      <iframe
        ref={frame}
        title={title}
        sandbox="allow-scripts"
        srcDoc={doc}
        scrolling="no"
        data-genui-frame
        className={cn("block size-full border-0 transition-opacity duration-(--dur-fast) ease-out", ready ? "opacity-100" : "opacity-0")}
      />
      {broken !== undefined && <p className="absolute inset-x-1 bottom-1 truncate text-micro text-faint-foreground">A script in this block stopped: {broken}</p>}
    </div>
  );
};

const Drawn = ({ nodes, world }: { nodes: readonly UiNode[]; world: World }) => {
  const target = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mount>>(undefined);
  const latest = useRef(nodes);
  useEffect(() => {
    const box = target.current;
    if (!box) return;
    installRuntime();
    const made = mount(box, world.host);
    view.current = made;
    made.render(latest.current);
    const leave = world.join(made);
    return () => {
      leave();
      made.stop();
      view.current = undefined;
      box.replaceChildren();
    };
  }, [world]);
  useEffect(() => {
    latest.current = nodes;
    view.current?.render(nodes);
  }, [nodes]);
  return <div ref={target} className="@container" />;
};

type Part = { kind: "drawn"; key: string; nodes: UiNode[] } | { kind: "sealed"; key: string; node: UiNode; closed: boolean };

const split = (nodes: readonly UiNode[], closedFrames: number) => {
  const parts: Part[] = [];
  let frames = 0;
  for (const node of nodes) {
    const last = parts.at(-1);
    if (node.tag === "Data") continue;
    if (node.tag === "Frame") {
      frames += 1;
      parts.push({ kind: "sealed", key: `f${frames}`, node, closed: frames <= closedFrames });
    } else if (last?.kind === "drawn") last.nodes.push(node);
    else parts.push({ kind: "drawn", key: `d${parts.length}`, nodes: [node] });
  }
  return parts;
};

const useStream = (source: string) => {
  const [stream, setStream] = useState({ run: 0, shown: source.length });
  useEffect(() => {
    if (stream.run === 0) return;
    const timer = setInterval(() => setStream((now) => (now.shown >= source.length ? now : { ...now, shown: now.shown + STREAM_STEP })), STREAM_MS);
    return () => clearInterval(timer);
  }, [stream.run, source]);
  return { run: stream.run, shown: Math.min(stream.shown, source.length), replay: () => setStream((now) => ({ run: now.run + 1, shown: 0 })) };
};

export type BlockState = "live" | "loading" | "stale";

export const GenBlock = ({
  title,
  source,
  sockets = NO_SOCKETS,
  reveal = false,
  state = "live",
  aside,
  className,
}: {
  title: string;
  source: string;
  sockets?: readonly string[];
  reveal?: boolean;
  state?: BlockState;
  aside?: ReactNode;
  className?: string;
}) => {
  const { run, shown, replay } = useStream(source);
  const streaming = shown < source.length;
  const inBrowser = useInBrowser();
  const world = useMemo(() => createWorld(sockets, state === "loading", run), [sockets, state, run]);
  useEffect(() => world.start(), [world]);

  const checked = useMemo(() => readSpec(source, { tools: TOOLS, reads: READ_NAMES, sockets }), [source, sockets]);
  const nodes = useMemo(() => parseSpec(source.slice(0, shown)).nodes, [source, shown]);
  const parts = useMemo(() => split(nodes, source.slice(0, shown).split("</Frame>").length - 1), [nodes, source, shown]);
  useEffect(() => {
    world.load(nodes.filter((node) => node.tag === "Data"));
  }, [nodes, world]);
  const layer = checked.isOk() ? checked.value.layer : 2;

  return (
    <article data-genui-block data-layer={layer} className={cn("flex min-w-0 flex-col rounded-2xl bg-popover shadow-lift", className)}>
      <header className="flex h-10 items-center gap-2 pr-1.5 pl-3.5">
        <AiMark className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h4 className="min-w-0 flex-1 truncate text-small font-medium">{title}</h4>
        {state === "stale" && <span className="shrink-0 text-micro whitespace-nowrap text-faint-foreground">As of 9:41 am</span>}
        {reveal && <Tag>{layer === 2 ? "Grammar" : "Sealed frame"}</Tag>}
        {aside}
        <button
          type="button"
          aria-label={`Draw ${title} again`}
          onClick={replay}
          className="grid size-7 shrink-0 place-items-center rounded-full text-faint-foreground transition-[background-color,color,scale] duration-(--dur-fast) ease-out hover:bg-foreground/[0.06] hover:text-foreground active:scale-[0.94]"
        >
          <ArrowClockwise weight="bold" className="size-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className={cn("flex min-w-0 flex-col gap-3 px-3.5 pb-3.5 transition-opacity duration-(--dur-base)", state === "stale" && "opacity-60")}>
        {checked.isErr() && !streaming ? (
          <div role="alert" className="rounded-xl bg-foreground/[0.045] px-3 py-2.5">
            <p className="text-small font-medium">This block could not be drawn</p>
            <p className="mt-0.5 text-micro text-pretty text-muted-foreground">{checked.error[0]}</p>
          </div>
        ) : parts.length === 0 && streaming ? (
          <Wait />
        ) : (
          parts.map((part) =>
            part.kind === "drawn" ? (
              <Drawn key={part.key} nodes={part.nodes} world={world} />
            ) : part.closed && inBrowser ? (
              <Suspense key={`${part.key}-${run}`} fallback={<Wait />}>
                <Sealed node={part.node} world={world} title={title} />
              </Suspense>
            ) : (
              <Wait key={part.key} />
            ),
          )
        )}
      </div>
    </article>
  );
};

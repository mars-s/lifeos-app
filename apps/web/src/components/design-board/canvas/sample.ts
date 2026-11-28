import type { Board, Card, Edge, Socket, StepCard, StepStatus } from "./model";

const folder = (id: string, label: string) => ({ id, label, type: "folder" }) satisfies Socket;
const file = (id: string, label: string) => ({ id, label, type: "file" }) satisfies Socket;
const text = (id: string, label: string) => ({ id, label, type: "text" }) satisfies Socket;
const number = (id: string, label: string) => ({ id, label, type: "number" }) satisfies Socket;

export const NOTES_BOARD: Board = {
  w: 1180,
  h: 560,
  cards: [
    { id: "chapter", kind: "group", label: "Chapter 3", x: 396, y: 28, w: 516, h: 320 },
    { id: "retrieval", kind: "note", note: "retrieval", x: 32, y: 72, w: 280, h: 164 },
    { id: "dense", kind: "note", note: "dense-sparse", x: 420, y: 76, w: 224, h: 148 },
    { id: "evaluation", kind: "note", note: "evaluation", x: 668, y: 164, w: 220, h: 148 },
    { id: "outline", kind: "note", note: "outline", x: 932, y: 396, w: 220, h: 132 },
    { id: "question", kind: "text", text: "What does the reranker buy us on the small index? Ask on Thursday.", x: 56, y: 324, w: 232, h: 84 },
    { id: "rerun", kind: "task", task: "rerun", x: 420, y: 420, w: 292, h: 36 },
    { id: "draft", kind: "task", task: "outline-draft", x: 596, y: 488, w: 232, h: 36 },
  ],
  edges: [
    { id: "a", from: "retrieval", to: "dense", label: "leans on" },
    { id: "b", from: "dense", to: "evaluation", fromSide: "right", toSide: "top", label: "tested by" },
    { id: "c", from: "question", to: "rerun", fromSide: "right", toSide: "left" },
    { id: "d", from: "rerun", to: "evaluation", fromSide: "top", toSide: "bottom", label: "feeds" },
    { id: "e", from: "evaluation", to: "outline", fromSide: "right", toSide: "top", label: "becomes 3.2" },
    { id: "f", from: "draft", to: "outline", fromSide: "right", toSide: "left" },
  ],
};

const STEP_W = 208;

const STEPS: StepCard[] = [
  {
    id: "write",
    kind: "step",
    title: "Write the film",
    runner: "claude",
    command: 'claude -p "/astack:html-video {brief}"',
    reach: ["Claude Code", "up to $2"],
    inputs: [text("brief", "brief")],
    outputs: [folder("film", "film")],
    x: 232,
    y: 40,
    w: STEP_W,
    h: 156,
  },
  {
    id: "preview",
    kind: "step",
    title: "Render the preview",
    runner: "shell",
    command: "node render.mjs {film}/index.html --all",
    reach: [],
    inputs: [folder("film", "film")],
    outputs: [file("mp4", "preview.mp4")],
    x: 476,
    y: 24,
    w: STEP_W,
    h: 156,
  },
  {
    id: "intake",
    kind: "step",
    title: "Intake",
    runner: "shell",
    command: "node intake.mjs {film}/index.html",
    reach: [],
    inputs: [folder("film", "film")],
    outputs: [folder("handoff", "handoff")],
    x: 476,
    y: 240,
    w: STEP_W,
    h: 156,
  },
  {
    id: "scenes",
    kind: "step",
    title: "Write the scenes",
    runner: "claude",
    command: 'claude -p "/astack:afterburn {handoff}"',
    reach: ["Claude Code", "up to $4"],
    inputs: [folder("handoff", "handoff")],
    outputs: [folder("scenes", "scenes")],
    x: 720,
    y: 24,
    w: STEP_W,
    h: 156,
  },
  {
    id: "sound",
    kind: "step",
    title: "Soundtrack",
    runner: "shell",
    command: "node tools/soundtrack.mjs {handoff}/cues.json",
    reach: [],
    inputs: [folder("handoff", "handoff")],
    outputs: [file("track", "track.wav")],
    x: 720,
    y: 240,
    w: STEP_W,
    h: 156,
  },
  {
    id: "frames",
    kind: "step",
    title: "Render the frames",
    runner: "shell",
    command: "nice -n 19 Blender -b -P {scenes}/shot.py",
    reach: ["about 6 min"],
    inputs: [folder("scenes", "scenes")],
    outputs: [folder("frames", "frames")],
    x: 964,
    y: 24,
    w: STEP_W,
    h: 156,
  },
  {
    id: "assemble",
    kind: "step",
    title: "Assemble",
    runner: "shell",
    command: "tools/assemble.sh {frames} {track} film.mp4",
    reach: [],
    inputs: [folder("frames", "frames"), file("track", "track")],
    outputs: [file("film", "film.mp4")],
    x: 1208,
    y: 132,
    w: STEP_W,
    h: 180,
  },
];

const stepOf = (id: string) => {
  const step = STEPS.find((item) => item.id === id);
  if (!step) throw new Error(`No step ${id}`);
  return step;
};

export const BRIEF: Card = {
  id: "brief",
  kind: "text",
  text: "Launch film, 40 seconds. One message: plan the day in a minute. Paper look, quiet pad, no voiceover.",
  x: 24,
  y: 40,
  w: 176,
  h: 148,
};

export const BUILD_STEPS = STEPS;

export const BUILD_EDGES: Edge[] = [
  { id: "brief-write", from: "brief", to: "write", toSocket: "brief" },
  { id: "write-preview", from: "write", fromSocket: "film", to: "preview", toSocket: "film" },
  { id: "write-intake", from: "write", fromSocket: "film", to: "intake", toSocket: "film" },
  { id: "intake-scenes", from: "intake", fromSocket: "handoff", to: "scenes", toSocket: "handoff" },
  { id: "intake-sound", from: "intake", fromSocket: "handoff", to: "sound", toSocket: "handoff" },
  { id: "scenes-frames", from: "scenes", fromSocket: "scenes", to: "frames", toSocket: "scenes" },
  { id: "frames-assemble", from: "frames", fromSocket: "frames", to: "assemble", toSocket: "frames" },
  { id: "sound-assemble", from: "sound", fromSocket: "track", to: "assemble", toSocket: "track" },
];

export const BUILD_SIZE = { w: 1440, h: 700 };
export const BUILD_ASK = "Set up a workflow that makes the launch film: preview first, then the Blender pass";
export const BUILD_FOLDER = "~/Films/lifeos-launch";

export const FRAME_COUNT = 720;
export const FRAME_START = 212;

const at = (id: string, x: number, y: number, h = stepOf(id).h) => ({ ...stepOf(id), x, y, h });

export const RUN_BOARD: Board = {
  w: 1180,
  h: 520,
  cards: [
    at("scenes", 24, 40),
    at("sound", 24, 256),
    at("frames", 280, 40, 178),
    { id: "look", kind: "view", title: "Frames", inputs: [folder("frames", "frames")], outputs: [], x: 788, y: 24, w: 368, h: 348 },
    at("assemble", 536, 256),
  ],
  edges: [
    { id: "scenes-frames", from: "scenes", fromSocket: "scenes", to: "frames", toSocket: "scenes" },
    { id: "frames-look", from: "frames", fromSocket: "frames", to: "look", toSocket: "frames" },
    { id: "frames-assemble", from: "frames", fromSocket: "frames", to: "assemble", toSocket: "frames" },
    { id: "sound-assemble", from: "sound", fromSocket: "track", to: "assemble", toSocket: "track" },
  ],
};

export const RUN_STATUS: Record<string, StepStatus> = {
  scenes: { state: "kept", words: "Kept from the last run" },
  sound: { state: "done", words: "Done in 9 s" },
  assemble: { state: "waiting", words: "Waiting for the frames" },
};

export const RUN_LOG = ["Fra:{frame} Mem:1.9G | Scene 3 of 5", "Saved: frames/{frame}.png", "Time: 00:00.61"];

export const SCENES = [
  { name: "Open", until: 96 },
  { name: "The list", until: 240 },
  { name: "The day", until: 420 },
  { name: "Focus", until: 588 },
  { name: "Close", until: 720 },
];

export const POSTER_TIMES = [1.5, 4, 9.2, 14.8, 22, 31.5];

export const BLOCK_BOARD: Board = {
  w: 1010,
  h: 380,
  cards: [
    { ...stepOf("assemble"), id: "assemble", x: 24, y: 96, reach: [] },
    { id: "poster-pick", kind: "block", title: "Pick the poster", inputs: [file("film", "film")], outputs: [number("time", "time")], x: 284, y: 24, w: 412, h: 332 },
    {
      id: "poster",
      kind: "step",
      title: "Poster frame",
      runner: "shell",
      command: "ffmpeg -ss {time} -i film.mp4 -frames:v 1 poster.png",
      reach: [],
      inputs: [number("time", "time")],
      outputs: [file("poster", "poster.png")],
      x: 748,
      y: 96,
      w: 238,
      h: 156,
    },
  ],
  edges: [
    { id: "film-block", from: "assemble", fromSocket: "film", to: "poster-pick", toSocket: "film" },
    { id: "block-poster", from: "poster-pick", fromSocket: "time", to: "poster", toSocket: "time" },
  ],
};

export const PLACES = [
  { place: "Mac", see: true, edit: true, start: true, run: true, note: "Runs every Step while it is awake" },
  { place: "Web", see: true, edit: true, start: true, run: false, note: "Starts a run. The Mac picks it up" },
  { place: "iPhone", see: true, edit: true, start: true, run: false, note: "Watches progress and small previews" },
] as const;

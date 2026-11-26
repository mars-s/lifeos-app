import type { Area, AreaId, Inline, LinkedTask, Note, NoteId, NoteLabel, Project, ProjectId, TaskId } from "./model";
import { NOTE_IDS, plainText, TASK_IDS } from "./model";

export const AREAS: Record<AreaId, Area> = {
  university: { name: "University", colour: "violet" },
  personal: { name: "Personal", colour: "green" },
  paperless: { name: "Paperless", colour: "orange" },
  korvant: { name: "Korvant", colour: "teal" },
  chemwatch: { name: "Chemwatch", colour: "rose" },
};

export const PROJECTS: Record<ProjectId, Project> = {
  thesis: { title: "Honours thesis", area: "university", progress: 0.4 },
  "japan-trip": { title: "Japan trip", area: "personal", progress: 0.15 },
  onboarding: { title: "Onboarding rework", area: "korvant", progress: 0.6 },
};

export const TASKS: Record<TaskId, LinkedTask> = {
  papers: { title: "Read two papers on retrieval", area: "university", project: "thesis", when: "Today", estimate: 60, done: false, notes: ["retrieval"] },
  "outline-draft": { title: "Draft the thesis outline", area: "university", project: "thesis", when: "Today", estimate: 90, done: false, notes: ["outline", "retrieval"] },
  rerun: { title: "Rerun the hybrid on the small index", area: "university", project: "thesis", done: false, notes: ["retrieval"] },
  ferry: { title: "Book the ferry to Naoshima", area: "personal", project: "japan-trip", when: "Sat 21 Nov", estimate: 15, done: false, notes: ["japan"] },
  "copy-review": { title: "Review the onboarding copy", area: "korvant", project: "onboarding", when: "Today", estimate: 45, done: true, notes: ["copy"] },
};

export const LABELS: NoteLabel[] = [
  { name: "Deep Work", colour: "plum" },
  { name: "Reading", colour: "slate" },
  { name: "Meeting", colour: "olive" },
];

const linkTo = (id: NoteId, alias?: string) => (alias ? { kind: "note", id, alias } : { kind: "note", id }) satisfies Inline;
const taskChip = (id: TaskId) => ({ kind: "entity", ref: { kind: "task", id } }) satisfies Inline;
const projectChip = (id: ProjectId) => ({ kind: "entity", ref: { kind: "project", id } }) satisfies Inline;
const areaChip = (id: AreaId) => ({ kind: "entity", ref: { kind: "area", id } }) satisfies Inline;
const strong = (text: string) => ({ kind: "strong", text }) satisfies Inline;
const code = (text: string) => ({ kind: "code", text }) satisfies Inline;
const label = (name: string) => ({ kind: "label", name }) satisfies Inline;
const missing = (title: string) => ({ kind: "missing", title }) satisfies Inline;

export const NOTES: Record<NoteId, Note> = {
  retrieval: {
    title: "Retrieval experiments",
    area: "university",
    project: "thesis",
    edited: "2 min ago",
    pinned: true,
    labels: ["Deep Work"],
    blocks: [
      {
        kind: "paragraph",
        text: [
          "Notes for chapter 3 of the ",
          linkTo("outline"),
          ". The question is whether a learned retriever beats BM25 on my course-notes corpus, which is the argument in ",
          linkTo("dense-sparse"),
          ".",
        ],
      },
      { kind: "paragraph", text: ["Background reading is ", taskChip("papers"), " in ", projectChip("thesis"), "."] },
      { kind: "heading", level: 2, text: ["What I need to show"] },
      {
        kind: "todos",
        items: [
          { id: "recall", done: true, text: ["Recall on questions the model has not seen"] },
          { id: "negatives", done: true, text: ["How each run picks its ", missing("Negative sampling")] },
          { id: "small-index", done: false, text: ["Rerun the hybrid on the small index"] },
          { id: "quote", done: false, text: ["One figure for the related work section"] },
        ],
      },
      { kind: "heading", level: 2, text: ["First runs"] },
      {
        kind: "paragraph",
        text: [
          "Both runs use the same 1,200 questions. The dense model is a small ",
          strong("bi-encoder"),
          ", fine-tuned for one epoch and scored with a dot product. ",
          code("recall@10"),
          " is the number the reader will care about.",
        ],
      },
      {
        kind: "table",
        head: ["Method", "Recall@10", "MRR", "Index"],
        figures: [1, 2, 3],
        rows: [
          ["BM25", "0.61", "0.44", "180 MB"],
          ["Dense, frozen", "0.58", "0.41", "1.1 GB"],
          ["Dense, fine-tuned", "0.72", "0.53", "1.1 GB"],
          ["Hybrid", "0.76", "0.57", "1.3 GB"],
        ],
      },
      {
        kind: "callout",
        tone: "idea",
        title: "The hybrid is the cheap win",
        text: ["Adding the BM25 score to the dense ranking costs 20 ms a query and gains four points. That is worth a section of its own in the ", linkTo("evaluation"), "."],
      },
      {
        kind: "code",
        language: "python",
        lines: [
          "def hybrid(query, k=10, alpha=0.3):",
          "    sparse = bm25.search(query, k=100)",
          "    dense = index.search(encode(query), k=100)",
          "    return fuse(sparse, dense, alpha)[:k]",
        ],
      },
      {
        kind: "quote",
        text: ["Measure the thing you will argue about, not the thing that is easy to measure."],
        cite: ["Dr Nguyen, ", linkTo("supervision")],
      },
    ],
  },
  outline: {
    title: "Thesis outline",
    area: "university",
    project: "thesis",
    edited: "Yesterday",
    pinned: true,
    labels: ["Deep Work"],
    blocks: [
      { kind: "paragraph", text: ["Three chapters at most. Start from the reading notes, not a blank page. Tracked as ", taskChip("outline-draft"), "."] },
      { kind: "heading", level: 2, text: ["Chapters"] },
      {
        kind: "bullets",
        items: [
          ["Why retrieval matters for study tools"],
          ["Related work, built on ", linkTo("dense-sparse")],
          ["Method and results, which lean on the ", linkTo("retrieval")],
        ],
      },
    ],
  },
  "dense-sparse": {
    title: "Dense vs sparse retrieval",
    area: "university",
    project: "thesis",
    edited: "Mon 16 Nov",
    labels: ["Reading"],
    blocks: [
      {
        kind: "paragraph",
        text: ["Sparse methods match the words. Dense methods match the meaning. My own numbers are in the ", linkTo("retrieval"), ", and they say the two fail on different questions."],
      },
    ],
  },
  supervision: {
    title: "Supervision, 17 Nov",
    area: "university",
    project: "thesis",
    edited: "Tue 17 Nov",
    labels: ["Meeting"],
    blocks: [
      { kind: "paragraph", text: ["Dr Nguyen wants the small-index run before the outline goes out. She liked the first table in the ", linkTo("retrieval"), "."] },
      { kind: "bullets", items: [["Send the outline by Sunday"], ["Keep chapter 2 under ten pages"]] },
    ],
  },
  evaluation: {
    title: "Evaluation plan",
    area: "university",
    project: "thesis",
    edited: "Sat 14 Nov",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["One held-out set of 300 questions, written before any tuning. Report recall and the time per query, nothing else."] }],
  },
  japan: {
    title: "Japan trip ideas",
    area: "personal",
    project: "japan-trip",
    edited: "Sun 15 Nov",
    labels: [],
    blocks: [
      { kind: "paragraph", text: ["Two weeks in April. Slow days, one place at a time. First thing to lock in is ", taskChip("ferry"), "."] },
      { kind: "image", src: "/art/painted/dusk.webp", alt: "A single tree on a hill under a violet evening sky", caption: "The hill behind the guesthouse, as I want to remember it" },
    ],
  },
  copy: {
    title: "Onboarding copy principles",
    area: "korvant",
    project: "onboarding",
    edited: "Fri 13 Nov",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["Say what happens next, in the words the customer uses. One idea a screen. Used for ", taskChip("copy-review"), " in ", projectChip("onboarding"), "."] }],
  },
  pricing: {
    title: "Paperless pricing",
    area: "paperless",
    edited: "Thu 12 Nov",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["Per seat is simple to explain and wrong for small firms. Try a flat tier up to five people for ", areaChip("paperless"), ", said in the plain words of the ", linkTo("copy"), "."] }],
  },
  sds: {
    title: "SDS template changes",
    area: "chemwatch",
    edited: "Wed 11 Nov",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["Section 9 gains two rows in the new template. The export has to keep the old order for existing customers."] }],
  },
  "reading-list": {
    title: "Reading list",
    edited: "Tue 10 Nov",
    labels: ["Reading"],
    blocks: [{ kind: "paragraph", text: ["Books to pick up after the thesis. Nothing about work, and two of them are for the ", linkTo("japan"), "."] }],
  },
  "day-19": {
    title: "Thursday 19 November",
    day: "2026-11-19",
    edited: "Just now",
    labels: [],
    blocks: [
      { kind: "paragraph", text: ["Good morning in the library. Ran the hybrid again before lunch, numbers are in the ", linkTo("retrieval"), "."] },
      { kind: "paragraph", text: ["Priya thinks the reading group should move to Fridays. ", label("Meeting")] },
    ],
    notebook: [{ page: 42, lines: ["Slept well, walked to campus", "Hybrid idea: add the two scores, do not learn the weight yet", "Ask Dr Nguyen about the small index"] }],
  },
  "day-18": {
    title: "Wednesday 18 November",
    day: "2026-11-18",
    edited: "Yesterday",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["Long day on the ", linkTo("outline"), ". Two chapters have one line each now."] }],
    notebook: [{ page: 41, lines: ["Outline: three chapters, no more", "Call the physio"] }],
  },
  "day-17": {
    title: "Tuesday 17 November",
    day: "2026-11-17",
    edited: "Tue 17 Nov",
    labels: [],
    blocks: [{ kind: "paragraph", text: ["Supervision went well, notes in ", linkTo("supervision"), "."] }],
  },
};

export const titleOf = (id: NoteId) => NOTES[id].title;

export const excerptOf = (id: NoteId) => {
  const first = NOTES[id].blocks.find((block) => block.kind === "paragraph");
  return first?.kind === "paragraph" ? plainText(first.text, titleOf) : "";
};

export const areaOf = (id: NoteId) => {
  const area = NOTES[id].area;
  return area ? AREAS[area] : undefined;
};

export const placeOf = (id: NoteId) => {
  const { area, project, day } = NOTES[id];
  if (day) return "Journal";
  if (project) return PROJECTS[project].title;
  return area ? AREAS[area].name : "Unfiled";
};

export const RECENT: NoteId[] = ["retrieval", "day-19", "outline", "supervision", "japan"];

export type TreeBranch = { area: AreaId; folders: { project: ProjectId; notes: NoteId[] }[]; loose: NoteId[] };

export const TREE: TreeBranch[] = (Object.keys(AREAS) as AreaId[]).map((area) => {
  const inArea = NOTE_IDS.filter((id) => NOTES[id].area === area);
  const projects = [...new Set(inArea.flatMap((id) => NOTES[id].project ?? []))];
  return {
    area,
    folders: projects.map((project) => ({ project, notes: inArea.filter((id) => NOTES[id].project === project) })),
    loose: inArea.filter((id) => NOTES[id].project === undefined),
  };
});

export const UNFILED: NoteId[] = NOTE_IDS.filter((id) => NOTES[id].area === undefined && NOTES[id].day === undefined);

export const WRITTEN_DAYS: ReadonlySet<number> = new Set([2, 3, 4, 5, 9, 10, 11, 12, 13, 16, 17, 18, 19]);

export const tasksMentioning = (id: NoteId) => TASK_IDS.filter((task) => TASKS[task].notes.includes(id));

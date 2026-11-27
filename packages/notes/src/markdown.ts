export type EntityTable = "tasks" | "projects" | "areas";

export type EntityLink = { readonly table: EntityTable; readonly id: string; readonly alias?: string };

export type FolderRef = { readonly table: "areas" | "projects"; readonly id: string };

export type NoteMeta = { readonly folder?: FolderRef; readonly day?: string };

export type NoteProjection = {
  readonly title: string;
  readonly excerpt: string;
  readonly words: number;
  readonly entities: EntityLink[];
  readonly noteTitles: string[];
  readonly labels: string[];
};

export const EXCERPT_LENGTH = 280;
export const UNTITLED = "Untitled";

const entityKinds = { task: "tasks", project: "projects", area: "areas" } as const satisfies Record<string, EntityTable>;

export type EntityKind = keyof typeof entityKinds;

export const entityKindOf = (table: EntityTable) =>
  (Object.keys(entityKinds) as EntityKind[]).find((kind) => entityKinds[kind] === table) ?? "task";

export const entityLinkPattern = /\[\[(task|project|area):([A-Za-z0-9]+)(?:\|([^\]\n]*))?\]\]/g;
export const noteLinkPattern = /\[\[(?!(?:task|project|area):)([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;
export const labelPattern = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

export const formatEntityLink = (link: EntityLink) =>
  `[[${entityKindOf(link.table)}:${link.id}${link.alias ? `|${link.alias.replaceAll(/[\]|\n]/g, " ").trim()}` : ""}]]`;

const withoutCode = (text: string) => text.replaceAll(/```[\s\S]*?(```|$)/g, " ").replaceAll(/`[^`\n]*`/g, " ");

export const titleOf = (text: string) => {
  const first = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  const plain = plainInline(first.replace(/^\s*#{1,6}\s+/, "")).trim();
  return plain.length > 0 ? plain.slice(0, 200) : UNTITLED;
};

export const plainInline = (line: string) =>
  line
    .replaceAll(entityLinkPattern, (_m, _kind: string, _id: string, alias?: string) => alias ?? "")
    .replaceAll(noteLinkPattern, (_m, title: string, alias?: string) => alias ?? title)
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/(\*\*|__|~~|==|\*|_|`)/g, "");

const plainLine = (line: string) =>
  plainInline(
    line
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*>\s?(\[![a-z]+\]\s*)?/i, "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
      .replace(/^\s*([-*+]|\d+\.)\s+/, "")
      .replace(/^\s*(---|\*\*\*|___)\s*$/, ""),
  )
    .replace(/^\s*\|/, "")
    .replaceAll("|", " ");

const unique = <T>(values: T[], key: (value: T) => string) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const projectNote = (text: string) => {
  const lines = text.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  const body = withoutCode(lines.slice(titleIndex + 1).join("\n"));
  const excerpt = body
    .split("\n")
    .map(plainLine)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT_LENGTH);
  const searchable = withoutCode(text);
  const entities = unique(
    [...searchable.matchAll(entityLinkPattern)].map((m) => ({
      table: entityKinds[m[1] as EntityKind],
      id: m[2] ?? "",
      ...(m[3] ? { alias: m[3] } : {}),
    })),
    (link) => `${link.table}:${link.id}`,
  );
  const noteTitles = unique(
    [...searchable.matchAll(noteLinkPattern)].map((m) => (m[1] ?? "").trim()).filter((t) => t.length > 0),
    (t) => t.toLowerCase(),
  );
  const labels = unique(
    [...searchable.matchAll(labelPattern)].map((m) => m[2] ?? "").filter((t) => t.length > 0),
    (t) => t.toLowerCase(),
  );
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return { title: titleOf(text), excerpt, words, entities, noteTitles, labels } satisfies NoteProjection;
};

export const titleKey = (title: string) => title.trim().toLowerCase().replaceAll(/\s+/g, " ");

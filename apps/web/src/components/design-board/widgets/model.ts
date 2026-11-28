import type { AreaColour } from "@/components/lifeos/area";

export type Mode = "colour" | "tinted" | "clear" | "vibrant" | "desktop" | "standby" | "night";
export type Size = "small" | "medium" | "large" | "xl";

export const SIZES = {
  small: { width: 164, height: 164 },
  medium: { width: 344, height: 164 },
  large: { width: 344, height: 360 },
  xl: { width: 704, height: 360 },
} as const satisfies Record<Size, { width: number; height: number }>;

export const GLYPH_ROWS = 7;

export const GLYPHS: Record<string, readonly string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ":": [".", ".", "#", ".", "#", ".", "."],
};

export const dotsOf = (value: string) => {
  const placed = [...value].reduce(
    (state, character) => {
      const rows = GLYPHS[character];
      if (!rows) return state;
      const lit = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [{ x: state.column + x, y }] : [])));
      return { column: state.column + (rows[0]?.length ?? 0) + 1, dots: [...state.dots, ...lit] };
    },
    { column: 0, dots: [] as { x: number; y: number }[] },
  );
  return { dots: placed.dots, columns: Math.max(0, placed.column - 1) };
};

export type AreaId = "university" | "personal" | "paperless" | "korvant" | "chemwatch";
export type Area = { name: string; colour: AreaColour };

export type Task = { id: string; title: string; area: AreaId; estimate: number; start?: number };
export type Span = { id: string; start: number; end: number; kind: "block" | "commitment" | "trip"; colour?: AreaColour };
export type Slice = { colour: AreaColour; minutes: number };
export type Day = { id: string; letter: string; weekday: string; date: number; capacity: number; slices: Slice[]; deadline?: boolean; today?: boolean };
export type Deadline = { id: string; title: string; area: AreaId; day: string; days: number };

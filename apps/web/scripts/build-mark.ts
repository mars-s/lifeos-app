import { mkdirSync, writeFileSync } from "node:fs";
import { MARK, markDots } from "../src/components/lifeos/mark-geometry.ts";

const PAPER = { tile: "#F7F4EF", empty: "#DDD9D2", filled: "#186BC5" };
const GRAPHITE = { tile: "#1A1B1D", empty: "#34363A", filled: "#5DADFC" };

const dots = (classes: boolean, palette = PAPER) =>
  markDots()
    .map((dot) => {
      const paint = classes
        ? `class="${dot.filled ? "f" : "e"}"`
        : `fill="${dot.filled ? palette.filled : palette.empty}"`;
      return `<circle cx="${dot.cx}" cy="${dot.cy}" r="${MARK.radius}" ${paint}/>`;
    })
    .join("");

const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.box} ${MARK.box}">`;
const tile = (attribute: string) =>
  `<rect width="${MARK.box}" height="${MARK.box}" rx="${MARK.tileRadius}" ${attribute}/>`;

const adaptive = `${open}<style>.t{fill:${PAPER.tile}}.e{fill:${PAPER.empty}}.f{fill:${PAPER.filled}}@media (prefers-color-scheme:dark){.t{fill:${GRAPHITE.tile}}.e{fill:${GRAPHITE.empty}}.f{fill:${GRAPHITE.filled}}}</style>${tile('class="t"')}${dots(true)}</svg>\n`;
const fixed = (palette: typeof PAPER) => `${open}${tile(`fill="${palette.tile}"`)}${dots(false, palette)}</svg>\n`;

const out = new URL("../public/", import.meta.url);
mkdirSync(new URL("brand/", out), { recursive: true });
writeFileSync(new URL("favicon.svg", out), adaptive);
writeFileSync(new URL("brand/mark-paper.svg", out), fixed(PAPER));
writeFileSync(new URL("brand/mark-graphite.svg", out), fixed(GRAPHITE));

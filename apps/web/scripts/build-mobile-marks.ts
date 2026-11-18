import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARK, markDots } from "../src/components/lifeos/mark-geometry.ts";

const assets = new URL("../../mobile/assets/", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "lifeos-mark-"));

const svg = (canvas: number, scale: number, filled: string, empty: string, background?: string, emptyOpacity = 1) => {
  const offset = (canvas - MARK.box * scale) / 2;
  const dots = markDots()
    .map(
      (dot) =>
        `<circle cx="${offset + dot.cx * scale}" cy="${offset + dot.cy * scale}" r="${MARK.radius * scale}" fill="${dot.filled ? filled : empty}" fill-opacity="${dot.filled ? 1 : emptyOpacity}"/>`,
    )
    .join("");
  const fill = background ? `<rect width="${canvas}" height="${canvas}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${fill}${dots}</svg>`;
};

const render = (name: string, source: string) => {
  const path = join(work, `${name}.svg`);
  writeFileSync(path, source);
  execFileSync("sips", ["-s", "format", "png", path, "--out", join(assets, `${name}.png`)], { stdio: "ignore" });
};

render("android-icon-foreground", svg(512, 8.6, "#186BC5", "#DDD9D2"));
render("android-icon-background", svg(512, 0, "#F7F4EF", "#F7F4EF", "#F7F4EF"));
render("android-icon-monochrome", svg(432, 7.2, "#FFFFFF", "#FFFFFF", undefined, 0.35));
render("splash-icon", svg(1024, 12, "#186BC5", "#DDD9D2"));
render("favicon", svg(48, 1.5, "#186BC5", "#DDD9D2", "#F7F4EF"));

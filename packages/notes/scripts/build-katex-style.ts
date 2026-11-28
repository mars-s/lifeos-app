import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const dist = dirname(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"));
const css = readFileSync(join(dist, "katex.min.css"), "utf8");

const inlined = css.replaceAll(/src:url\((fonts\/[\w-]+\.woff2)\)[^;}]*/g, (_match, file: string) => {
  const font = readFileSync(join(dist, file)).toString("base64");
  return `src:url(data:font/woff2;base64,${font}) format("woff2")`;
});

if (inlined.includes("url(fonts/")) throw new Error("A KaTeX font was left as a file link");

writeFileSync(new URL("../src/editor/katex-style.gen.ts", import.meta.url), `export const katexStyle = ${JSON.stringify(inlined)};\n`);

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { MARK, markDots } from "../src/components/lifeos/mark-geometry.ts";

const SIZE = 44;
const SAMPLES = 4;
const EMPTY_ALPHA = 0.34;
const INSET = 0.8;

const scale = (SIZE / MARK.box) * (MARK.box / (MARK.span + MARK.radius * 2 + INSET * 2));
const offset = (MARK.box - MARK.span) / 2 - MARK.radius - INSET;
const dots = markDots().map((dot) => ({ x: (dot.cx - offset) * scale, y: (dot.cy - offset) * scale, r: MARK.radius * scale, alpha: dot.filled ? 1 : EMPTY_ALPHA }));

const coverage = (px: number, py: number) => {
  let best = 0;
  for (const dot of dots) {
    let inside = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const x = px + (sx + 0.5) / SAMPLES - dot.x;
        const y = py + (sy + 0.5) / SAMPLES - dot.y;
        if (x * x + y * y <= dot.r * dot.r) inside += 1;
      }
    }
    best = Math.max(best, (inside / SAMPLES ** 2) * dot.alpha);
  }
  return best;
};

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) raw[y * (SIZE * 4 + 1) + 1 + x * 4 + 3] = Math.round(coverage(x, y) * 255);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = (table[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../../desktop/src-tauri/icons/tray.png", import.meta.url), png);

"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const CELL = 13;
const MAX_RADIUS = 0.4;
const MIN_RADIUS = 0.07;

const draw = (canvas: HTMLCanvasElement, image: HTMLImageElement, tone: "light" | "dark") => {
  const box = canvas.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  const columns = Math.ceil(box.width / CELL);
  const rows = Math.ceil(box.height / CELL);

  const sampler = document.createElement("canvas");
  sampler.width = columns;
  sampler.height = rows;
  const sample = sampler.getContext("2d", { willReadFrequently: true });
  const context = canvas.getContext("2d");
  if (!sample || !context) return;

  const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const cropWidth = box.width / scale;
  const cropHeight = box.height / scale;
  sample.drawImage(
    image,
    (image.naturalWidth - cropWidth) / 2,
    (image.naturalHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    columns,
    rows,
  );
  const pixels = sample.getImageData(0, 0, columns, rows).data;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, box.width, box.height);
  context.fillStyle = tone === "light" ? "#ffffff" : "#16130f";
  const luminances = Array.from(
    { length: columns * rows },
    (_, cell) =>
      (0.2126 * (pixels[cell * 4] ?? 0) + 0.7152 * (pixels[cell * 4 + 1] ?? 0) + 0.0722 * (pixels[cell * 4 + 2] ?? 0)) / 255,
  );
  const darkest = Math.min(...luminances);
  const span = Math.max(0.28, Math.max(...luminances) - darkest);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const stretched = ((luminances[row * columns + column] ?? 0) - darkest) / span;
      const weight = tone === "light" ? stretched : 1 - stretched;
      const offsetX = Math.abs((column + 0.5) / columns - 0.5) * 2;
      const offsetY = Math.abs((row + 0.5) / rows - 0.5) * 2;
      const edge = Math.min(1, (1 - Math.max(offsetX, offsetY)) / 0.18);
      const quiet = Math.min(1, Math.hypot(offsetX / 0.42, offsetY / 0.5));
      const sweep = ((column + 0.5) / columns) * 0.6 + ((row + 0.5) / rows) * 0.4;
      const region = Math.min(1, Math.max(0, (sweep - 0.22) / 0.5));
      const presence = edge * region * (0.12 + 0.88 * quiet ** 2);
      const radius = CELL * (MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * weight ** 1.4);
      context.globalAlpha = presence * (0.05 + weight * 0.3);
      context.beginPath();
      context.arc(column * CELL + CELL / 2, row * CELL + CELL / 2, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
};

export const DotMatrix = ({
  src,
  tone = "light",
  className,
}: {
  src: string;
  tone?: "light" | "dark";
  className?: string;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const image = new Image();
    const redraw = () => {
      if (image.complete && image.naturalWidth > 0) draw(target, image, tone);
    };
    image.addEventListener("load", redraw);
    image.src = src;
    const observer = new ResizeObserver(redraw);
    observer.observe(target);
    return () => {
      image.removeEventListener("load", redraw);
      observer.disconnect();
    };
  }, [src, tone]);

  return <canvas ref={canvas} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
};

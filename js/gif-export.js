/** 将表情帧序列导出为 GIF（浏览器端） */

import { GIFEncoder, quantize, applyPalette } from "./gifenc.esm.js";
import { drawFace } from "./oled-renderer.js";
import { sampleSceneAt, sceneTotalDuration } from "./frame-interpolation.js";

export const GIF_EXPORT_FPS = 10;

export function buildSceneGifBytes(frames, width, height, { fps = GIF_EXPORT_FPS } = {}) {
  if (!frames?.length) throw new Error("无帧数据");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const totalMs = sceneTotalDuration(frames);
  const frameInterval = Math.max(50, Math.round(1000 / fps));
  const frameCount = Math.max(2, Math.ceil(totalMs / frameInterval) + 1);

  const gif = GIFEncoder();
  for (let i = 0; i < frameCount; i += 1) {
    const elapsed = Math.min(i * frameInterval, totalMs);
    const elements = sampleSceneAt(frames, elapsed);
    drawFace(ctx, elements, { width, height, showGrid: false });
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay: frameInterval });
  }
  gif.finish();
  return gif.bytes();
}

export function downloadGifBytes(bytes, filename) {
  const base = String(filename || "animation").replace(/\.gif$/i, "");
  const blob = new Blob([bytes], { type: "image/gif" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `${base}.gif`;
  a.click();
  URL.revokeObjectURL(url);
}

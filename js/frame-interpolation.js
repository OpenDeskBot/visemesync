/** 帧间图元插值（用于表情动画预览） */

import { LAYER_ORDER, normalizeShapeType, rgb565ToCss, rgbToRgb565 } from "./oled-renderer.js";

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb565(c1, c2, t) {
  const parse = (c) => {
    const css = rgb565ToCss(c);
    const m = css.match(/\d+/g);
    return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
  };
  const [r1, g1, b1] = parse(c1);
  const [r2, g2, b2] = parse(c2);
  return rgbToRgb565(
    Math.round(lerp(r1, r2, t)),
    Math.round(lerp(g1, g2, t)),
    Math.round(lerp(b1, b2, t)),
  );
}

export function interpolateShape(shapeA, shapeB, t) {
  if (!shapeA) return shapeB ? structuredClone(shapeB) : null;
  if (!shapeB) return shapeA ? structuredClone(shapeA) : null;
  const typeA = normalizeShapeType(shapeA.shape);
  const typeB = normalizeShapeType(shapeB.shape);
  if (typeA !== typeB) return t < 0.5 ? structuredClone(shapeA) : structuredClone(shapeB);

  const out = structuredClone(shapeA);
  for (const key of Object.keys(out)) {
    if (key === "shape") continue;
    const va = shapeA[key];
    const vb = shapeB[key];
    if (typeof va === "number" && typeof vb === "number") {
      out[key] = key === "c" ? lerpRgb565(va, vb, t) : Math.round(lerp(va, vb, t));
    }
  }
  return out;
}

function interpolateLayer(shapesA, shapesB, t) {
  const a = shapesA || [];
  const b = shapesB || [];
  const maxLen = Math.max(a.length, b.length);
  const result = [];
  for (let i = 0; i < maxLen; i += 1) {
    const sa = a[i];
    const sb = b[i];
    if (sa && sb) result.push(interpolateShape(sa, sb, t));
    else if (sa && t < 0.5) result.push(structuredClone(sa));
    else if (sb && t >= 0.5) result.push(structuredClone(sb));
  }
  return result;
}

export function interpolateElements(elA, elB, t) {
  const a = elA || {};
  const b = elB || {};
  const out = {};
  for (const layer of LAYER_ORDER) {
    if (layer === "bg") continue;
    out[layer] = interpolateLayer(a[layer], b[layer], t);
  }
  return out;
}

/** 计算场景总时长（每帧 ms 含过渡或末帧停顿） */
export function sceneTotalDuration(frames) {
  if (!frames?.length) return 0;
  return frames.reduce((s, f) => s + Math.max(16, f.ms ?? 800), 0);
}

/** 按经过时间采样场景图元（循环） */
export function sampleSceneAt(frames, elapsedMs) {
  if (!frames?.length) return null;
  if (frames.length === 1) return frames[0].elements || {};

  const total = sceneTotalDuration(frames);
  if (total <= 0) return frames[0].elements || {};

  let t = ((elapsedMs % total) + total) % total;
  let acc = 0;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const dur = Math.max(16, frames[i].ms ?? 800);
    if (t < acc + dur) {
      const lt = (t - acc) / dur;
      return interpolateElements(frames[i].elements, frames[i + 1].elements, lt);
    }
    acc += dur;
  }

  const last = frames[frames.length - 1];
  return last.elements || {};
}

/** OLED / pb 图元绘制（284×240 逻辑坐标，与 deskbot pb 协议一致） */

export const LAYER_ORDER = ["bg", "nose", "mouth", "eye_l", "eye_r", "extra"];

export const LAYER_LABELS = {
  bg: "背景",
  nose: "鼻子",
  mouth: "嘴巴",
  eye_l: "左眼",
  eye_r: "右眼",
  extra: "附加",
};

export const LAYER_COLORS = {
  bg: "#444",
  nose: "#fc6",
  mouth: "#f66",
  eye_l: "#6cf",
  eye_r: "#9cf",
  extra: "#c9f",
};

export const HANDLE_SIZE = 7;
const MIN_DIM = 2;
const ROTATION_STEP = 45;

/** 旋转矩形 angle 仅支持 45° 整数倍（0/45/90/…） */
export function snapRotationAngle(deg) {
  const n = Number(deg) || 0;
  const snapped = Math.round(n / ROTATION_STEP) * ROTATION_STEP;
  return ((snapped % 360) + 360) % 360;
}

export function normalizeShapeAngle(shape) {
  const sh = normalizeShapeType(shape?.shape);
  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    shape.angle = snapRotationAngle(shape.angle ?? 0);
  }
}

/** shape 别名 → 规范 id */
export const SHAPE_ALIASES = {
  fill_rect: "rect",
  fillrect: "rect",
  draw_rect: "rect_outline",
  drawrect: "rect_outline",
  fill_circle: "circle",
  fillcircle: "circle",
  draw_circle: "circle_outline",
  drawcircle: "circle_outline",
  fillroundrect: "round_rect",
  fill_round_rect: "round_rect",
  drawroundrect: "round_rect_outline",
  draw_round_rect: "round_rect_outline",
  drawellipse: "ellipse",
  draw_ellipse: "ellipse",
  fillellipse: "ellipse_fill",
  fill_ellipse: "ellipse_fill",
  drawline: "line",
  draw_line: "line",
  point: "pixel",
  drawpixel: "pixel",
  h_line: "hline",
  drawfasthline: "hline",
  v_line: "vline",
  drawfastvline: "vline",
  drawtriangle: "triangle",
  draw_triangle: "triangle",
  filltriangle: "triangle_fill",
  fill_triangle: "triangle_fill",
  draw_rotated_rect: "rotated_rect_outline",
  fill_rotated_rect: "rotated_rect_fill",
};

export const SHAPE_TYPES = [
  { id: "rect", label: "实心矩形" },
  { id: "rect_outline", label: "空心矩形" },
  { id: "circle", label: "实心圆" },
  { id: "circle_outline", label: "空心圆" },
  { id: "round_rect", label: "实心圆角矩形" },
  { id: "round_rect_outline", label: "空心圆角矩形" },
  { id: "ellipse", label: "空心椭圆" },
  { id: "ellipse_fill", label: "实心椭圆" },
  { id: "line", label: "线段" },
  { id: "pixel", label: "单像素点" },
  { id: "hline", label: "水平线" },
  { id: "vline", label: "垂直线" },
  { id: "triangle", label: "空心三角形" },
  { id: "triangle_fill", label: "实心三角形" },
  { id: "rotated_rect_outline", label: "空心旋转矩形", hint: "angle 仅 45° 步进，用于斜眉等" },
  { id: "rotated_rect_fill", label: "实心旋转矩形", hint: "angle 仅 45° 步进" },
];

export function normalizeShapeType(type) {
  const raw = String(type || "").toLowerCase();
  return SHAPE_ALIASES[raw] || raw;
}

export function rgb565ToCss(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return "#fff";
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  const r = Math.round((r5 / 31) * 255);
  const g = Math.round((g6 / 63) * 255);
  const b = Math.round((b5 / 31) * 255);
  return `rgb(${r},${g},${b})`;
}

export function rgb565ToHex(c) {
  const css = rgb565ToCss(c);
  const m = css.match(/\d+/g);
  if (!m) return "#ffffff";
  return (
    "#" +
    m
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function rgbToRgb565(r, g, b) {
  const r5 = Math.round((r / 255) * 31) & 0x1f;
  const g6 = Math.round((g / 255) * 63) & 0x3f;
  const b5 = Math.round((b / 255) * 31) & 0x1f;
  return (r5 << 11) | (g6 << 5) | b5;
}

export function hexToRgb565(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return rgbToRgb565(r, g, b);
  }
  if (h.length >= 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return rgbToRgb565(r, g, b);
  }
  return 65535;
}

/** 将 RGB565 量化到 256 色 (RGB332: R3+G3+B2 bit)，存储仍为 RGB565 */
export function quantizeColor256(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 65535;
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  const r = Math.round((r5 / 31) * 255);
  const g = Math.round((g6 / 63) * 255);
  const b = Math.round((b5 / 31) * 255);
  const r3 = Math.round((r / 255) * 7);
  const g3 = Math.round((g / 255) * 7);
  const b2 = Math.round((b / 255) * 3);
  const rq = Math.round((r3 / 7) * 255);
  const gq = Math.round((g3 / 7) * 255);
  const bq = Math.round((b2 / 3) * 255);
  return rgbToRgb565(rq, gq, bq);
}

export function quantizeElementsColors(elements) {
  if (!elements || typeof elements !== "object") return;
  for (const k of LAYER_ORDER) {
    for (const shape of elements[k] || []) {
      if (shape?.c != null) shape.c = quantizeColor256(shape.c);
    }
  }
}

/** 常用 OLED 色板（RGB565，已量化到 256 色） */
export const PALETTE_COLORS = [
  { c: 65535, label: "白" },
  { c: 0, label: "黑" },
  { c: 63488, label: "红" },
  { c: 2016, label: "绿" },
  { c: 31, label: "蓝" },
  { c: 65504, label: "黄" },
  { c: 2047, label: "青" },
  { c: 63519, label: "品红" },
  { c: 32348, label: "左眼" },
  { c: 28122, label: "右眼" },
  { c: 19605, label: "嘴线" },
  { c: 52845, label: "灰" },
].map(({ c, label }) => ({ c: quantizeColor256(c), label }));

export function drawShape(ctx, shape, stroke, fillAlpha = 0.25) {
  if (!shape || !ctx) return;
  const s = shape;
  const sh = normalizeShapeType(s.shape);
  const fillColor = rgb565ToCss(s.c ?? 65535);
  ctx.strokeStyle = stroke || "#888";
  ctx.fillStyle = fillColor.replace("rgb", "rgba").replace(")", `,${fillAlpha})`);
  ctx.lineWidth = 1;

  if (sh === "circle" || sh === "circle_outline") {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    if (sh === "circle") ctx.fill();
    ctx.stroke();
    return;
  }
  if (sh === "rect" || sh === "rect_outline") {
    if (sh === "rect") ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    return;
  }
  if (sh === "round_rect" || sh === "round_rect_outline") {
    const rad = Math.min(Number(s.radius ?? s.r) || 0, s.w / 2, s.h / 2);
    roundRectPath(ctx, s.x, s.y, s.w, s.h, rad);
    if (sh === "round_rect") ctx.fill();
    ctx.stroke();
    return;
  }
  if (sh === "ellipse" || sh === "ellipse_fill") {
    const rx = s.rw ?? s.w ?? s.r ?? 4;
    const ry = s.rh ?? s.h ?? s.r ?? 4;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, rx, ry, 0, 0, Math.PI * 2);
    if (sh === "ellipse_fill") ctx.fill();
    ctx.stroke();
    return;
  }
  if (sh === "line") {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    return;
  }
  if (sh === "pixel") {
    ctx.fillStyle = fillColor;
    ctx.fillRect(s.x, s.y, 1, 1);
    return;
  }
  if (sh === "hline") {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.w, s.y);
    ctx.stroke();
    return;
  }
  if (sh === "vline") {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y + s.h);
    ctx.stroke();
    return;
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.closePath();
    if (sh === "triangle_fill") ctx.fill();
    ctx.stroke();
    return;
  }
  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(((s.angle || 0) * Math.PI) / 180);
    const hw = s.w / 2;
    const hh = s.h / 2;
    if (sh === "rotated_rect_fill") ctx.fillRect(-hw, -hh, s.w, s.h);
    ctx.strokeRect(-hw, -hh, s.w, s.h);
    ctx.restore();
  }
}

function roundRectPath(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export function drawFace(ctx, elements, options = {}) {
  const {
    width = 284,
    height = 240,
    showGrid = true,
    highlight = null,
    highlights = null,
    handleTarget = null,
    lockedLayers = [],
  } = options;
  const hiList = highlights ?? (highlight ? [highlight] : []);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  if (showGrid) drawGrid(ctx, width, height);
  const el = elements || {};
  for (const key of LAYER_ORDER) {
    if (key === "bg" && !options.drawBg) continue;
    const locked = lockedLayers.includes(key);
    const list = el[key] || [];
    for (let i = 0; i < list.length; i += 1) {
      const shape = list[i];
      const isHi = hiList.some((h) => h.layer === key && h.index === i);
      const stroke = isHi ? "#ff0" : locked ? "rgba(140,160,180,0.55)" : LAYER_COLORS[key] || "#888";
      const alpha = isHi ? 0.45 : locked ? 0.12 : 0.22;
      drawShape(ctx, shape, stroke, alpha);
    }
  }
  const ht =
    handleTarget ||
    (hiList.length === 1 && !lockedLayers.includes(hiList[0].layer) ? hiList[0] : null);
  if (ht?.layer != null && ht.index != null) {
    const shape = (el[ht.layer] || [])[ht.index];
    if (shape) drawShapeHandles(ctx, shape);
  }
  if (lockedLayers.length) drawLockOverlays(ctx, el, lockedLayers);
}

/** 锁定图层遮光罩（斜线遮罩 + 半透明暗色） */
function drawLockOverlays(ctx, elements, lockedLayers) {
  ctx.save();
  for (const key of lockedLayers) {
    for (const shape of elements[key] || []) {
      const b = getShapeBounds(shape);
      const pad = 4;
      const x = b.x - pad;
      const y = b.y - pad;
      const w = Math.max(b.w + pad * 2, 6);
      const h = Math.max(b.h + pad * 2, 6);
      ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 1;
      for (let i = -h; i < w + h; i += 7) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i - h, y + h);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  ctx.restore();
}

function drawGrid(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShapeHandles(ctx, shape) {
  const handles = getShapeHandles(shape);
  ctx.save();
  for (const h of handles) {
    const hs = HANDLE_SIZE;
    if (h.id === "radius") {
      ctx.fillStyle = "#fd6";
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(h.x, h.y, hs / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
  }
  ctx.restore();
}

function roundRectRadius(s) {
  return Math.min(Number(s.radius ?? s.r) || 0, (s.w || 0) / 2, (s.h || 0) / 2);
}

/** 操作点列表：{ id, x, y, cursor } */
export function getShapeHandles(shape) {
  const sh = normalizeShapeType(shape.shape);
  const s = shape;

  if (sh === "rect" || sh === "rect_outline") {
    const { x, y, w, h } = s;
    return [
      { id: "top", x: x + w / 2, y, cursor: "ns-resize" },
      { id: "right", x: x + w, y: y + h / 2, cursor: "ew-resize" },
      { id: "bottom", x: x + w / 2, y: y + h, cursor: "ns-resize" },
      { id: "left", x, y: y + h / 2, cursor: "ew-resize" },
    ];
  }
  if (sh === "round_rect" || sh === "round_rect_outline") {
    const { x, y, w, h } = s;
    const rad = roundRectRadius(s);
    return [
      { id: "top", x: x + w / 2, y, cursor: "ns-resize" },
      { id: "right", x: x + w, y: y + h / 2, cursor: "ew-resize" },
      { id: "bottom", x: x + w / 2, y: y + h, cursor: "ns-resize" },
      { id: "left", x, y: y + h / 2, cursor: "ew-resize" },
      { id: "radius", x: x + rad, y: y + rad, cursor: "nwse-resize" },
    ];
  }
  if (sh === "circle" || sh === "circle_outline") {
    return [
      { id: "r", x: s.x + s.r, y: s.y, cursor: "ew-resize" },
      { id: "t", x: s.x, y: s.y - s.r, cursor: "ns-resize" },
      { id: "b", x: s.x, y: s.y + s.r, cursor: "ns-resize" },
      { id: "l", x: s.x - s.r, y: s.y, cursor: "ew-resize" },
    ];
  }
  if (sh === "ellipse" || sh === "ellipse_fill") {
    const rx = s.rw ?? s.w ?? s.r ?? 4;
    const ry = s.rh ?? s.h ?? s.r ?? 4;
    return [
      { id: "rx", x: s.x + rx, y: s.y, cursor: "ew-resize" },
      { id: "ry", x: s.x, y: s.y + ry, cursor: "ns-resize" },
      { id: "lx", x: s.x - rx, y: s.y, cursor: "ew-resize" },
      { id: "ty", x: s.x, y: s.y - ry, cursor: "ns-resize" },
    ];
  }
  if (sh === "line") {
    return [
      { id: "p1", x: s.x1, y: s.y1, cursor: "move" },
      { id: "p2", x: s.x2, y: s.y2, cursor: "move" },
    ];
  }
  if (sh === "hline") {
    return [
      { id: "left", x: s.x, y: s.y, cursor: "ew-resize" },
      { id: "right", x: s.x + s.w, y: s.y, cursor: "ew-resize" },
    ];
  }
  if (sh === "vline") {
    return [
      { id: "top", x: s.x, y: s.y, cursor: "ns-resize" },
      { id: "bottom", x: s.x, y: s.y + s.h, cursor: "ns-resize" },
    ];
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    return [
      { id: "v0", x: s.x0, y: s.y0, cursor: "move" },
      { id: "v1", x: s.x1, y: s.y1, cursor: "move" },
      { id: "v2", x: s.x2, y: s.y2, cursor: "move" },
    ];
  }
  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    const rad = ((s.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = s.w / 2;
    const hh = s.h / 2;
    const corners = [
      { id: "tl", lx: -hw, ly: -hh },
      { id: "tr", lx: hw, ly: -hh },
      { id: "br", lx: hw, ly: hh },
      { id: "bl", lx: -hw, ly: hh },
    ];
    const handles = corners.map((c) => ({
      id: c.id,
      x: s.x + c.lx * cos - c.ly * sin,
      y: s.y + c.lx * sin + c.ly * cos,
      cursor: "nwse-resize",
    }));
    handles.push({
      id: "angle",
      x: s.x + (hw + 16) * cos,
      y: s.y + (hw + 16) * sin,
      cursor: "crosshair",
    });
    return handles;
  }
  return [];
}

export function hitTestHandle(shape, x, y) {
  const hs = HANDLE_SIZE + 4;
  for (const h of getShapeHandles(shape)) {
    if (Math.abs(x - h.x) <= hs / 2 && Math.abs(y - h.y) <= hs / 2) return h;
  }
  return null;
}

export function dragShapeHandle(shape, handleId, dx, dy, pointer) {
  const sh = normalizeShapeType(shape.shape);
  const s = shape;

  if (sh === "rect" || sh === "rect_outline") {
    if (handleId === "top") {
      s.y += dy;
      s.h -= dy;
    } else if (handleId === "bottom") {
      s.h += dy;
    } else if (handleId === "left") {
      s.x += dx;
      s.w -= dx;
    } else if (handleId === "right") {
      s.w += dx;
    }
    if (s.w < MIN_DIM) {
      if (handleId === "left") s.x -= MIN_DIM - s.w;
      s.w = MIN_DIM;
    }
    if (s.h < MIN_DIM) {
      if (handleId === "top") s.y -= MIN_DIM - s.h;
      s.h = MIN_DIM;
    }
    return;
  }

  if (sh === "round_rect" || sh === "round_rect_outline") {
    if (handleId === "radius") {
      const rad = roundRectRadius(s);
      const nr = Math.round(Math.max(MIN_DIM, Math.min(s.w / 2, s.h / 2, rad + (dx + dy) / 2)));
      if (s.radius != null) s.radius = nr;
      else s.r = nr;
      return;
    }
    if (handleId === "top") {
      s.y += dy;
      s.h -= dy;
    } else if (handleId === "bottom") {
      s.h += dy;
    } else if (handleId === "left") {
      s.x += dx;
      s.w -= dx;
    } else if (handleId === "right") {
      s.w += dx;
    }
    if (s.w < MIN_DIM) {
      if (handleId === "left") s.x -= MIN_DIM - s.w;
      s.w = MIN_DIM;
    }
    if (s.h < MIN_DIM) {
      if (handleId === "top") s.y -= MIN_DIM - s.h;
      s.h = MIN_DIM;
    }
    const cap = Math.min(s.w / 2, s.h / 2);
    if (s.radius != null) s.radius = Math.min(s.radius, cap);
    if (s.r != null) s.r = Math.min(s.r, cap);
    return;
  }

  if (sh === "circle" || sh === "circle_outline") {
    if (handleId === "r" || handleId === "l") {
      s.r = Math.max(MIN_DIM, s.r + (handleId === "r" ? dx : -dx));
    } else if (handleId === "t" || handleId === "b") {
      s.r = Math.max(MIN_DIM, s.r + (handleId === "b" ? dy : -dy));
    }
    return;
  }

  if (sh === "ellipse" || sh === "ellipse_fill") {
    if (handleId === "rx" || handleId === "lx") {
      const d = handleId === "rx" ? dx : -dx;
      s.rw = Math.max(MIN_DIM, (s.rw ?? s.w ?? 4) + d);
      if (s.w != null) s.w = s.rw;
    } else if (handleId === "ry" || handleId === "ty") {
      const d = handleId === "ry" ? dy : -dy;
      s.rh = Math.max(MIN_DIM, (s.rh ?? s.h ?? 4) + d);
      if (s.h != null) s.h = s.rh;
    }
    return;
  }

  if (sh === "line") {
    if (handleId === "p1") {
      s.x1 += dx;
      s.y1 += dy;
    } else if (handleId === "p2") {
      s.x2 += dx;
      s.y2 += dy;
    }
    return;
  }

  if (sh === "hline") {
    if (handleId === "left") {
      s.x += dx;
      s.w -= dx;
    } else if (handleId === "right") {
      s.w += dx;
    }
    s.w = Math.max(MIN_DIM, s.w);
    return;
  }

  if (sh === "vline") {
    if (handleId === "top") {
      s.y += dy;
      s.h -= dy;
    } else if (handleId === "bottom") {
      s.h += dy;
    }
    s.h = Math.max(MIN_DIM, s.h);
    return;
  }

  if (sh === "triangle" || sh === "triangle_fill") {
    const key = { v0: ["x0", "y0"], v1: ["x1", "y1"], v2: ["x2", "y2"] }[handleId];
    if (key) {
      s[key[0]] += dx;
      s[key[1]] += dy;
    }
    return;
  }

  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    if (handleId === "angle") {
      if (pointer) {
        s.angle = snapRotationAngle((Math.atan2(pointer.y - s.y, pointer.x - s.x) * 180) / Math.PI);
      }
      return;
    }
    const rad = ((s.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const ldx = dx * cos + dy * sin;
    const ldy = -dx * sin + dy * cos;
    if (handleId === "tr" || handleId === "br") s.w = Math.max(MIN_DIM, s.w + ldx);
    if (handleId === "tl" || handleId === "bl") {
      s.w = Math.max(MIN_DIM, s.w - ldx);
      s.x += (ldx / 2) * cos;
      s.y += (ldx / 2) * sin;
    }
    if (handleId === "bl" || handleId === "br") s.h = Math.max(MIN_DIM, s.h + ldy);
    if (handleId === "tl" || handleId === "tr") {
      s.h = Math.max(MIN_DIM, s.h - ldy);
      s.x -= (ldy / 2) * sin;
      s.y += (ldy / 2) * cos;
    }
  }
}

/** 图元轴对齐包围盒 */
export function getShapeBounds(shape) {
  const sh = normalizeShapeType(shape.shape);
  const s = shape;
  if (sh === "circle" || sh === "circle_outline") {
    const r = s.r || 0;
    return { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
  }
  if (sh === "rect" || sh === "rect_outline" || sh === "round_rect" || sh === "round_rect_outline") {
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  }
  if (sh === "ellipse" || sh === "ellipse_fill") {
    const rx = s.rw ?? s.w ?? s.r ?? 4;
    const ry = s.rh ?? s.h ?? s.r ?? 4;
    return { x: s.x - rx, y: s.y - ry, w: rx * 2, h: ry * 2 };
  }
  if (sh === "line") {
    const x1 = Math.min(s.x1, s.x2);
    const y1 = Math.min(s.y1, s.y2);
    return { x: x1, y: y1, w: Math.max(Math.abs(s.x2 - s.x1), 1), h: Math.max(Math.abs(s.y2 - s.y1), 1) };
  }
  if (sh === "pixel") {
    return { x: s.x, y: s.y, w: 1, h: 1 };
  }
  if (sh === "hline") {
    return { x: s.x, y: s.y, w: s.w, h: 1 };
  }
  if (sh === "vline") {
    return { x: s.x, y: s.y, w: 1, h: s.h };
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    const xs = [s.x0, s.x1, s.x2];
    const ys = [s.y0, s.y1, s.y2];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    const rad = ((s.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = s.w / 2;
    const hh = s.h / 2;
    const pts = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((p) => ({
      x: s.x + p.x * cos - p.y * sin,
      y: s.y + p.x * sin + p.y * cos,
    }));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (s.x != null && s.y != null) return { x: s.x, y: s.y, w: 1, h: 1 };
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function boundsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 命中测试：返回 { layer, index, shape } 或 null */
export function hitTest(elements, x, y, options = {}) {
  const { layers = null } = options;
  const order = layers || ["extra", "eye_r", "eye_l", "mouth", "nose", "bg"];
  for (const layer of order) {
    const list = elements[layer] || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (pointInShape(list[i], x, y)) return { layer, index: i, shape: list[i] };
    }
  }
  return null;
}

function pointInShape(s, px, py) {
  const sh = normalizeShapeType(s.shape);
  if (sh === "circle" || sh === "circle_outline") {
    const dx = px - s.x;
    const dy = py - s.y;
    return dx * dx + dy * dy <= (s.r + 4) ** 2;
  }
  if (sh === "rect" || sh === "rect_outline" || sh === "round_rect" || sh === "round_rect_outline") {
    return px >= s.x - 4 && px <= s.x + s.w + 4 && py >= s.y - 4 && py <= s.y + s.h + 4;
  }
  if (sh === "ellipse" || sh === "ellipse_fill") {
    const rx = s.rw ?? s.w ?? s.r ?? 4;
    const ry = s.rh ?? s.h ?? s.r ?? 4;
    const dx = (px - s.x) / rx;
    const dy = (py - s.y) / ry;
    return dx * dx + dy * dy <= 1.2;
  }
  if (sh === "line") {
    return distToSegment(px, py, s.x1, s.y1, s.x2, s.y2) <= 6;
  }
  if (sh === "pixel") {
    return px >= s.x && px <= s.x + 4 && py >= s.y && py <= s.y + 4;
  }
  if (sh === "hline") {
    return py >= s.y - 4 && py <= s.y + 4 && px >= s.x - 4 && px <= s.x + s.w + 4;
  }
  if (sh === "vline") {
    return px >= s.x - 4 && px <= s.x + 4 && py >= s.y - 4 && py <= s.y + s.h + 4;
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    return pointInTriangle(px, py, s.x0, s.y0, s.x1, s.y1, s.x2, s.y2);
  }
  if (sh === "rotated_rect_outline" || sh === "rotated_rect_fill") {
    const rad = ((s.angle || 0) * Math.PI) / 180;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    const lx = (px - s.x) * cos - (py - s.y) * sin;
    const ly = (px - s.x) * sin + (py - s.y) * cos;
    return lx >= -s.w / 2 - 4 && lx <= s.w / 2 + 4 && ly >= -s.h / 2 - 4 && ly <= s.h / 2 + 4;
  }
  return false;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInTriangle(px, py, x0, y0, x1, y1, x2, y2) {
  const d1 = sign(px, py, x0, y0, x1, y1);
  const d2 = sign(px, py, x1, y1, x2, y2);
  const d3 = sign(px, py, x2, y2, x0, y0);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(px, py, x1, y1, x2, y2) {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
}

export function defaultShape(type, layer) {
  const norm = normalizeShapeType(type);
  const base = { shape: norm, c: 65535 };
  if (norm.includes("round_rect")) {
    return { ...base, x: 178, y: 156, w: 40, h: 12, radius: 6 };
  }
  if (norm === "circle" || norm === "circle_outline") {
    const cx = layer === "eye_l" ? 86 : layer === "eye_r" ? 198 : 142;
    const cy = layer === "nose" ? 124 : 97;
    return { ...base, x: cx, y: cy, r: layer === "nose" ? 11 : 17 };
  }
  if (norm.includes("ellipse")) {
    const cx = layer === "eye_l" ? 86 : 198;
    return { ...base, x: cx, y: 97, rw: 17, rh: 17 };
  }
  if (norm === "line") {
    return { ...base, x1: 120, y1: 160, x2: 164, y2: 160 };
  }
  if (norm === "pixel") {
    return { ...base, x: 142, y: 120 };
  }
  if (norm === "hline") {
    return { ...base, x: 120, y: 160, w: 64 };
  }
  if (norm === "vline") {
    return { ...base, x: 142, y: 140, h: 40 };
  }
  if (norm.includes("triangle")) {
    return { ...base, x0: 130, y0: 170, x1: 170, y1: 170, x2: 150, y2: 140 };
  }
  if (norm.includes("rotated_rect")) {
    return { ...base, x: 142, y: 156, w: 40, h: 12, angle: 0 };
  }
  return { ...base, x: 102, y: 151, w: 80, h: 20 };
}

/** 将图元中心/锚点移到 (x, y) */
export function centerShapeAt(shape, x, y) {
  const sh = normalizeShapeType(shape.shape);
  if (sh === "line") {
    const mx = (shape.x1 + shape.x2) / 2;
    const my = (shape.y1 + shape.y2) / 2;
    const dx = x - mx;
    const dy = y - my;
    shape.x1 += dx;
    shape.y1 += dy;
    shape.x2 += dx;
    shape.y2 += dy;
    return;
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    const mx = (shape.x0 + shape.x1 + shape.x2) / 3;
    const my = (shape.y0 + shape.y1 + shape.y2) / 3;
    moveShape(shape, x - mx, y - my);
    return;
  }
  if (sh === "rect" || sh === "rect_outline" || sh === "round_rect" || sh === "round_rect_outline") {
    shape.x = Math.round(x - shape.w / 2);
    shape.y = Math.round(y - shape.h / 2);
    return;
  }
  if (sh === "hline") {
    shape.x = Math.round(x - shape.w / 2);
    shape.y = Math.round(y);
    return;
  }
  if (sh === "vline") {
    shape.x = Math.round(x);
    shape.y = Math.round(y - shape.h / 2);
    return;
  }
  if (shape.x != null) shape.x = Math.round(x);
  if (shape.y != null) shape.y = Math.round(y);
}

export function defaultShapeAt(type, layer, x, y, color) {
  const shape = defaultShape(type, layer);
  if (color != null) shape.c = color;
  centerShapeAt(shape, x, y);
  return shape;
}

export function moveShape(shape, dx, dy) {
  const sh = normalizeShapeType(shape.shape);
  if (sh === "line") {
    shape.x1 += dx;
    shape.y1 += dy;
    shape.x2 += dx;
    shape.y2 += dy;
    return;
  }
  if (sh === "triangle" || sh === "triangle_fill") {
    shape.x0 += dx;
    shape.y0 += dy;
    shape.x1 += dx;
    shape.y1 += dy;
    shape.x2 += dx;
    shape.y2 += dy;
    return;
  }
  if (shape.x != null) shape.x += dx;
  if (shape.y != null) shape.y += dy;
}

export function scaleShape(shape, factor, anchor) {
  const sh = normalizeShapeType(shape.shape);
  const ax = anchor?.x ?? shape.x ?? 0;
  const ay = anchor?.y ?? shape.y ?? 0;
  const scaleVal = (v, origin) => origin + (v - origin) * factor;

  if (sh === "circle" || sh === "circle_outline") {
    shape.r = Math.max(1, Math.round(shape.r * factor));
    shape.x = scaleVal(shape.x, ax);
    shape.y = scaleVal(shape.y, ay);
    return;
  }
  if (sh === "rect" || sh === "rect_outline" || sh === "round_rect" || sh === "round_rect_outline") {
    const nx = scaleVal(shape.x, ax);
    const ny = scaleVal(shape.y, ay);
    shape.w = Math.max(2, Math.round(shape.w * factor));
    shape.h = Math.max(2, Math.round(shape.h * factor));
    shape.x = nx;
    shape.y = ny;
    if (shape.radius != null) shape.radius = Math.max(1, Math.round(shape.radius * factor));
    return;
  }
  if (sh === "ellipse" || sh === "ellipse_fill") {
    shape.rw = Math.max(1, Math.round((shape.rw || 4) * factor));
    shape.rh = Math.max(1, Math.round((shape.rh || 4) * factor));
    shape.x = scaleVal(shape.x, ax);
    shape.y = scaleVal(shape.y, ay);
    return;
  }
  if (sh === "hline") {
    shape.w = Math.max(2, Math.round(shape.w * factor));
    shape.x = scaleVal(shape.x, ax);
    shape.y = scaleVal(shape.y, ay);
    return;
  }
  if (sh === "vline") {
    shape.h = Math.max(2, Math.round(shape.h * factor));
    shape.x = scaleVal(shape.x, ax);
    shape.y = scaleVal(shape.y, ay);
  }
}

export function applyOffset(prims, dx, dy) {
  return (prims || []).map((p) => {
    const q = structuredClone(p);
    moveShape(q, Number(dx) || 0, Number(dy) || 0);
    return q;
  });
}

export function phonemeGroupToElements(group, baseElements) {
  const g = group || {};
  const fd = baseElements || {};
  const dx = g.offset?.x || 0;
  const dy = g.offset?.y || 0;
  return {
    mouth: structuredClone(g.elements || []),
    nose: applyOffset(fd.nose || [], dx, dy),
    eye_l: applyOffset(fd.eye_l || [], dx, dy),
    eye_r: applyOffset(fd.eye_r || [], dx, dy),
    extra: applyOffset(fd.extra || [], dx, dy),
  };
}

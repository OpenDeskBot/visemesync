/** 默认数据与表情模型 */

import { quantizeElementsColors } from "./oled-renderer.js";

export const DEFAULT_CANVAS = { w: 284, h: 240 };

export const DEFAULT_FACE = {
  eye_l: [{ shape: "ellipse_fill", x: 86, y: 97, rw: 17, rh: 17, c: 32348 }],
  eye_r: [{ shape: "ellipse_fill", x: 198, y: 97, rw: 17, rh: 17, c: 28122 }],
  nose: [],
  mouth: [{ shape: "round_rect_outline", x: 178, y: 156, w: 40, h: 12, radius: 6, c: 19605 }],
  extra: [],
};

export const ZH_PHONEMES = [
  "a", "o", "e", "i", "u", "v", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "er",
  "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong", "ua", "uo", "uai", "ui", "uan",
  "un", "uang", "ve", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "zh", "ch", "sh",
  "r", "z", "c", "s", "j", "q", "x", "y", "w", "sil", "_",
];

/** 情绪表情预设（不含 default / 基准） */
export const EMOTION_PRESETS = [
  { name: "idle", title: "日常待机", desc: "待机表情" },
  { name: "happy", title: "开心", desc: "上扬嘴角、弯眼" },
  { name: "shy", title: "害羞", desc: "缩小嘴、腮红" },
  { name: "angry", title: "生气", desc: "倒眉、紧闭嘴" },
  { name: "curious", title: "好奇", desc: "睁大眼、微张嘴" },
  { name: "alert", title: "警惕", desc: "竖眼、平直嘴" },
  { name: "surprised", title: "惊讶", desc: "圆眼、O 型嘴" },
];

const SKIP_EMOTION_NAMES = new Set(["_", "default"]);

export function defaultFrame(elements, ms = 800) {
  return {
    ms,
    elements: structuredClone(elements || DEFAULT_FACE),
  };
}

export function defaultExpression(name = "expr", title = "新表情", alias = []) {
  return {
    name,
    alias: [...alias],
    title,
    frames: [defaultFrame()],
  };
}

function normalizeElements(raw) {
  if (!raw) return structuredClone(DEFAULT_FACE);
  const el = structuredClone(DEFAULT_FACE);
  for (const k of ["eye_l", "eye_r", "nose", "mouth", "extra"]) {
    if (Array.isArray(raw[k])) el[k] = structuredClone(raw[k]);
  }
  quantizeElementsColors(el);
  return el;
}

function normalizeFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return [defaultFrame()];
  return frames.map((fr) => ({
    ms: Math.max(16, Number(fr.ms) || 800),
    elements: normalizeElements(fr.elements),
  }));
}

/** 统一表情格式：{ name, alias, title, frames } */
export function normalizeExpression(raw) {
  if (!raw || typeof raw !== "object") throw new Error("无效表情对象");
  if (raw.name == null || !Array.isArray(raw.frames)) {
    throw new Error("表情需包含 name 与 frames");
  }
  return {
    name: String(raw.name),
    alias: Array.isArray(raw.alias) ? raw.alias.map(String).filter(Boolean) : [],
    title: raw.title != null ? String(raw.title) : String(raw.name),
    frames: normalizeFrames(raw.frames),
  };
}

export function expressionMatchKeys(expr) {
  return [expr?.name, ...(expr?.alias || [])].filter(Boolean);
}

/** 匹配 name 或 alias 中任一项 */
export function matchExpression(expr, key) {
  if (!expr || key == null) return false;
  const k = String(key);
  if (expr.name === k) return true;
  return (expr.alias || []).includes(k);
}

export function findExpressionKeyConflicts(expressions) {
  const map = new Map();
  (expressions || []).forEach((expr, idx) => {
    for (const key of expressionMatchKeys(expr)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(idx);
    }
  });
  return [...map.entries()]
    .filter(([, idxs]) => new Set(idxs).size > 1)
    .map(([key, idxs]) => ({ key, indices: [...new Set(idxs)] }));
}

export function formatExpressionConflictError(conflicts, expressions) {
  return conflicts
    .map(({ key, indices }) => {
      const labels = indices
        .map((i) => `#${i + 1}「${expressions[i]?.title || expressions[i]?.name}」`)
        .join("、");
      return `标识「${key}」重复于 ${labels}`;
    })
    .join("；");
}

export function validateExpressionList(doc, label = "表情列表") {
  if (!Array.isArray(doc)) throw new Error(`${label} 顶层必须是数组`);
  return doc.map((row, i) => {
    try {
      return normalizeExpression(row);
    } catch (e) {
      throw new Error(`${label}[${i}]: ${e.message || e}`);
    }
  });
}

export function validatePhonemeDoc(doc) {
  return validateExpressionList(doc, "音素表情");
}

export function validateScenesDoc(doc) {
  const list = validateExpressionList(doc, "情绪表情");
  return filterEmotionExpressions(list);
}

export function filterEmotionExpressions(list) {
  return (list || []).filter((e) => !SKIP_EMOTION_NAMES.has(e.name));
}

export function defaultPhonemeExpression(phoneme = "a") {
  return defaultExpression(phoneme, `音素 ${phoneme}`, []);
}

export function defaultPhonemeDoc() {
  return [defaultPhonemeExpression("a")];
}

function tweakSceneForEmotion(name, el) {
  if (name === "happy") {
    el.mouth = [{ shape: "round_rect_outline", x: 170, y: 158, w: 56, h: 14, radius: 7, c: 19605 }];
    el.eye_l[0].rh = 12;
    el.eye_r[0].rh = 12;
  } else if (name === "shy") {
    el.mouth = [{ shape: "round_rect_outline", x: 185, y: 158, w: 28, h: 8, radius: 4, c: 19605 }];
    el.extra = [{ shape: "ellipse_fill", x: 62, y: 133, rw: 9, rh: 4, c: 65535 }];
  } else if (name === "angry") {
    el.mouth = [{ shape: "round_rect_outline", x: 168, y: 162, w: 60, h: 8, radius: 4, c: 19605 }];
    el.eye_l[0].rh = 10;
    el.eye_r[0].rh = 10;
  } else if (name === "curious") {
    el.mouth = [{ shape: "round_rect_outline", x: 182, y: 154, w: 32, h: 18, radius: 9, c: 19605 }];
    el.eye_l[0].rw = 20;
    el.eye_r[0].rw = 20;
  } else if (name === "alert") {
    el.mouth = [{ shape: "round_rect_outline", x: 172, y: 160, w: 52, h: 6, radius: 3, c: 19605 }];
    el.eye_l[0].rh = 8;
    el.eye_r[0].rh = 8;
  } else if (name === "surprised") {
    el.mouth = [{ shape: "round_rect_outline", x: 184, y: 148, w: 24, h: 28, radius: 12, c: 19605 }];
    el.eye_l[0].rw = 22;
    el.eye_r[0].rw = 22;
  }
}

export function defaultScene(preset) {
  const p = preset || EMOTION_PRESETS[0];
  const face = structuredClone(DEFAULT_FACE);
  tweakSceneForEmotion(p.name, face);
  return {
    name: p.name,
    alias: [],
    title: p.title,
    frames: [defaultFrame(face, 520)],
  };
}

export function defaultScenesDoc() {
  return EMOTION_PRESETS.map((p) => defaultScene(p));
}

export function formatExpressionJson(expr, indent = 2) {
  return JSON.stringify(expr, null, indent);
}

export const SOURCE_FILENAME = "source.json";

/** 完整源码：音素 + 情绪共用同一文件 */
export function validateSourceDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("source.json 顶层必须是对象");
  }
  if (!Array.isArray(doc.phoneme_expressions) || !Array.isArray(doc.emotion_expressions)) {
    throw new Error("source.json 需包含 phoneme_expressions 与 emotion_expressions 数组");
  }
  return {
    phoneme_expressions: validatePhonemeDoc(doc.phoneme_expressions),
    emotion_expressions: validateScenesDoc(doc.emotion_expressions),
  };
}

/** Agent 合并源代码：{ phoneme_expressions, emotion_expressions } */
export function applySourceDoc(doc, state) {
  if (!doc || typeof doc !== "object") throw new Error("无效源代码对象");
  const validated = validateSourceDoc(doc);
  return {
    ...state,
    phonemeExpressions: validated.phoneme_expressions,
    emotionExpressions: validated.emotion_expressions,
  };
}

export async function loadJsonUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: HTTP ${res.status}`);
  return res.json();
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

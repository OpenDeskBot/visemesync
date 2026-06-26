/** Agent patch write：增量合并到 source.json */

import { normalizeExpression, validateSourceDoc } from "./data-models.js";

function parsePatchInput(patchRaw) {
  if (typeof patchRaw === "string") {
    try {
      return JSON.parse(patchRaw);
    } catch (e) {
      throw new Error(`patch 不是合法 JSON: ${e.message || e}`);
    }
  }
  if (!patchRaw || typeof patchRaw !== "object" || Array.isArray(patchRaw)) {
    throw new Error("patch 必须是 JSON 对象");
  }
  return patchRaw;
}

function upsertExpression(list, raw) {
  const expr = normalizeExpression(raw);
  const idx = list.findIndex((e) => e.name === expr.name);
  if (idx >= 0) list[idx] = expr;
  else list.push(expr);
  return expr.name;
}

function removeByNames(list, names, label) {
  if (!Array.isArray(names) || !names.length) return [];
  const removeSet = new Set(names.map(String));
  const removed = [];
  for (const name of removeSet) {
    if (!list.some((e) => e.name === name)) {
      throw new Error(`${label} 中不存在 name「${name}」`);
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (removeSet.has(list[i].name)) {
      removed.push(list[i].name);
      list.splice(i, 1);
    }
  }
  return removed;
}

/** 将 patch 合并进 baseDoc，返回校验后的完整源码 */
export function applySourcePatch(baseDoc, patchRaw) {
  const patch = parsePatchInput(patchRaw);
  const base = validateSourceDoc(baseDoc);

  const merged = {
    name: base.name,
    description: base.description,
    phonemes: structuredClone(base.phonemes),
    emotions: structuredClone(base.emotions),
  };

  if (patch.name != null) merged.name = String(patch.name);
  if (patch.description != null) merged.description = String(patch.description);

  const removedPhonemes = removeByNames(merged.phonemes, patch.removePhonemes, "removePhonemes");
  const removedEmotions = removeByNames(merged.emotions, patch.removeEmotions, "removeEmotions");

  const upsertedPhonemes = [];
  const upsertedEmotions = [];

  if (Array.isArray(patch.phonemes)) {
    for (let i = 0; i < patch.phonemes.length; i++) {
      try {
        upsertedPhonemes.push(upsertExpression(merged.phonemes, patch.phonemes[i]));
      } catch (e) {
        throw new Error(`patch.phonemes[${i}]: ${e.message || e}`);
      }
    }
  }

  if (Array.isArray(patch.emotions)) {
    for (let i = 0; i < patch.emotions.length; i++) {
      try {
        upsertedEmotions.push(upsertExpression(merged.emotions, patch.emotions[i]));
      } catch (e) {
        throw new Error(`patch.emotions[${i}]: ${e.message || e}`);
      }
    }
  }

  const doc = validateSourceDoc(merged);
  return {
    doc,
    summary: {
      upsertedPhonemes,
      upsertedEmotions,
      removedPhonemes,
      removedEmotions,
      metaChanged: patch.name != null || patch.description != null,
    },
  };
}

export function formatPatchResultMessage(result) {
  const { doc, summary } = result;
  const parts = [];
  if (summary.upsertedPhonemes.length) {
    parts.push(`音素 ${summary.upsertedPhonemes.join(", ")}`);
  }
  if (summary.upsertedEmotions.length) {
    parts.push(`情绪 ${summary.upsertedEmotions.join(", ")}`);
  }
  if (summary.removedPhonemes.length) {
    parts.push(`删音素 ${summary.removedPhonemes.join(", ")}`);
  }
  if (summary.removedEmotions.length) {
    parts.push(`删情绪 ${summary.removedEmotions.join(", ")}`);
  }
  if (summary.metaChanged) parts.push("元信息");
  const detail = parts.length ? `（${parts.join("；")}）` : "";
  return `已 patch 应用 source.json${detail} · 共 ${doc.phonemes.length} 音素 + ${doc.emotions.length} 情绪`;
}

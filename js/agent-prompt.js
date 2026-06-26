/** Agent 系统 Prompt：音素 vs 情绪 + read/write 工具 */

import { compactJsonStringify } from "./agent-tools.js";

const SHAPE_DOC = `
图元 shape 类型：rect, rect_outline, circle, circle_outline, round_rect, round_rect_outline,
ellipse, ellipse_fill, line, pixel, hline, vline, triangle, triangle_fill,
rotated_rect_outline, rotated_rect_fill（angle 仅 45° 整数倍）。
图层 elements 键：eye_l, eye_r, nose, mouth, extra（均为图元数组）。
颜色 c 为 RGB565 整数，但只能使用 256 色 (RGB332) 量化后的值。画布默认 284×240，坐标原点在左上。
`.trim();

const EXPRESSION_SCHEMA = `
单个表情对象格式：
{
  "name": "idle",
  "alias": [],
  "title": "日常待机",
  "frames": [
    {
      "ms": 520,
      "elements": {
        "eye_l": [{ "shape": "ellipse_fill", "x": 86, "y": 97, "rw": 17, "rh": 17, "c": 32348 }],
        "eye_r": [...],
        "nose": [],
        "mouth": [...],
        "extra": []
      }
    }
  ]
}
匹配规则：name 或 alias 中任一项命中即使用该表情。
`.trim();

const PHONEME_ROLE = `
【音素表情 phonemes】
- 用途：说话时按当前音素/拼音匹配口型与面部形态（Viseme）。
- 典型场景：发「a」张大嘴、发「o」圆嘴、发「sil」闭嘴；也可调整眉眼配合口型。
- 命名：name 常用单音素如 "a"、"ang"、"sil"；alias 放同组别名。
- 帧：多数只需 1 帧；如需过渡可多加帧。
`.trim();

const EMOTION_ROLE = `
【情绪表情 emotions】
- 用途：设备待机/交互时的情绪状态（开心、害羞、警惕等），非发音口型。
- 典型场景：idle 待机、happy 开心、surprised 惊讶；常含多帧动画。
- 命名：name 如 "idle"、"happy"；alias 如 "standby"。
- 帧：可多帧 + ms 组成动画；末帧 ms 为停顿时长。
`.trim();

const DIFF_DOC = `
【二者差异】
| 维度 | 音素表情 | 情绪表情 |
| 触发 | 语音/TTS 音素匹配 | 情绪状态/场景切换 |
| 主要改动 | 口型 mouth，必要时眼鼻 | 整体神态，常多帧 |
| 源码字段 | phonemes | emotions |
| 结构 | 完全相同（name/alias/title/frames） | 相同 |

音素与情绪共用同一 JSON 文件；顶层还有 name（设计名称）与 description（设计说明）。
`.trim();

const PATCH_SCHEMA = `
patch 增量格式（推荐，只含变更字段）：
{
  "name": "可选，设计名称",
  "description": "可选，设计说明",
  "phonemes": [ { "name": "a", "title": "...", "alias": [], "frames": [...] } ],
  "emotions": [ { "name": "idle", "title": "...", "alias": [], "frames": [...] } ],
  "removePhonemes": ["要删除的音素 name"],
  "removeEmotions": ["要删除的情绪 name"]
}
· phonemes/emotions：按 name 匹配，存在则整项替换，不存在则追加；未提及的表情保持不动
· 每个 patch 条目须含完整 frames，不是只改单个字段
`.trim();

const TOOL_DOC = `
【虚拟文件与工具】
- source.json：唯一源码文件（Agent 读写均映射到此文件）

工具（必须通过工具修改数据，禁止在回复中粘贴大段 JSON）：
- patch("source.json", patch)：**推荐**。增量合并，只提交变更的表情或元信息
- write("source.json", content)：全量替换，仅在大改时使用
- read("source.json")：可选；完整源码已在 system 末尾嵌入，一般无需 read

${PATCH_SCHEMA}

【工作流程】
1. 以下「当前 source.json」即最新源码，每次发送用户消息时自动刷新，无需 read
2. 用中文向用户说明修改思路（可结合「当前编辑焦点」优先改哪一块）
3. 优先用 patch 提交变更（通常只含 1 条 phonemes 或 emotions）；全量重写才用 write
4. 成功后简要总结改动

注意：name/alias 在同一列表内不可重复；rotated_rect 的 angle 仅 45° 倍数。
`.trim();

export function buildSourceDoc(phonemeExpressions, emotionExpressions, meta = {}) {
  return {
    name: meta.name != null ? String(meta.name) : "未命名设计",
    description: meta.description != null ? String(meta.description) : "",
    phonemes: phonemeExpressions,
    emotions: emotionExpressions,
  };
}

export function buildAgentSystemPrompt(ctx) {
  const {
    tab,
    canvas,
    currentExpression,
    selectedIndex,
    phonemeCount,
    emotionCount,
    docName,
    docDescription,
    sourceDoc,
  } = ctx;

  const focus =
    tab === "phoneme"
      ? `【当前编辑焦点：音素表情】
用户正在编辑 phonemes[${selectedIndex}]（共 ${phonemeCount} 项）。
优先修改 phonemes；除非用户明确要求，否则保持 emotions 不变。
当前选中：name="${currentExpression?.name}" title="${currentExpression?.title}"`
      : tab === "scene"
        ? `【当前编辑焦点：情绪表情】
用户正在编辑 emotions[${selectedIndex}]（共 ${emotionCount} 项）。
优先修改 emotions；除非用户明确要求，否则保持 phonemes 不变。
当前选中：name="${currentExpression?.name}" title="${currentExpression?.title}"`
        : `【当前编辑焦点：源码文件】
用户在「源码文件」Tab 查看/编辑完整 JSON（音素与情绪共用）。`;

  return `你是 VisemeSync 表情 JSON 编辑助手，帮助用户修改 Deskbot 面部 OLED 表情数据。

当前设计：name="${docName || ""}" description="${docDescription || ""}"

${EXPRESSION_SCHEMA}
${SHAPE_DOC}

${PHONEME_ROLE}

${EMOTION_ROLE}

${DIFF_DOC}

${TOOL_DOC}

${focus}

画布尺寸：${canvas.w}×${canvas.h}

【当前 source.json（实时嵌入，无需 read）】
${sourceDoc ? compactJsonStringify(sourceDoc) : "{}"}`;
}

/** 将 session 消息转为 API messages */
export function sessionToApiMessages(sessionMessages) {
  return sessionMessages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
    }
    if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.content || null };
      if (m.tool_calls?.length) msg.tool_calls = m.tool_calls;
      return msg;
    }
    return { role: m.role, content: m.content };
  });
}

export function apiMessagesToSession(apiMessages) {
  return apiMessages.map((m) => {
    if (m.role === "tool") {
      let toolName = "";
      let path = "";
      const prev = apiMessages.find(
        (x) => x.role === "assistant" && x.tool_calls?.some((tc) => tc.id === m.tool_call_id),
      );
      const tc = prev?.tool_calls?.find((t) => t.id === m.tool_call_id);
      if (tc) {
        toolName = tc.function?.name || "";
        try {
          path = JSON.parse(tc.function?.arguments || "{}").path || "";
        } catch {
          /* ignore */
        }
      }
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
        toolName,
        path,
      };
    }
    return { ...m };
  });
}

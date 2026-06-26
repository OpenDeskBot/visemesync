/** Agent 虚拟文件系统：read / patch / write 工具（统一映射 source.json） */

import { applySourcePatch, formatPatchResultMessage } from "./agent-patch.js";

export const VIRTUAL_PATHS = ["source.json"];

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description:
        "可选：再次读取 source.json（紧凑 JSON）。完整源码已嵌入 system prompt，通常无需调用。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: VIRTUAL_PATHS,
            description: "虚拟文件路径，固定为 source.json",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch",
      description:
        "增量更新 source.json（推荐）。仅提交变更的表情或元信息，客户端自动合并进当前源码；按 name upsert 表情。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: VIRTUAL_PATHS,
            description: "虚拟文件路径，固定为 source.json",
          },
          patch: {
            type: "string",
            description:
              "JSON 字符串：可选 name/description；phonemes/emotions 为要新增或替换的完整表情对象数组；removePhonemes/removeEmotions 为要删除的 name 列表",
          },
        },
        required: ["path", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write",
      description:
        "全量替换 source.json。仅在大改或 patch 不便时使用；content 为完整 JSON 字符串。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: VIRTUAL_PATHS,
            description: "虚拟文件路径，固定为 source.json",
          },
          content: {
            type: "string",
            description: "完整 JSON 字符串（非 markdown 代码块）",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

/** 紧凑序列化，减少 token 体积 */
export function compactJsonStringify(value) {
  return JSON.stringify(value);
}

export function createToolExecutor(hooks) {
  const vfs = {
    read(path) {
      if (path !== "source.json") {
        throw new Error(`未知路径: ${path}，仅支持 source.json`);
      }
      const doc = hooks.getAgentContext().sourceDoc;
      return compactJsonStringify(doc);
    },

    patch(path, patchContent) {
      if (path !== "source.json") {
        throw new Error(`未知路径: ${path}，仅支持 source.json`);
      }
      const base = hooks.getAgentContext().sourceDoc;
      const result = applySourcePatch(base, patchContent);
      hooks.applySourceDoc(result.doc);
      return formatPatchResultMessage(result);
    },

    write(path, content) {
      if (path !== "source.json") {
        throw new Error(`未知路径: ${path}，仅支持 source.json`);
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new Error(`content 不是合法 JSON: ${e.message || e}`);
      }
      hooks.applySourceDoc(parsed);
      return `已 write 全量应用 source.json（${parsed.phonemes?.length ?? "?"} 音素 + ${parsed.emotions?.length ?? "?"} 情绪）`;
    },
  };

  return async function executeTool(name, args) {
    if (name === "read") return vfs.read(args.path);
    if (name === "patch") return vfs.patch(args.path, args.patch);
    if (name === "write") return vfs.write(args.path, args.content);
    throw new Error(`未知工具: ${name}`);
  };
}

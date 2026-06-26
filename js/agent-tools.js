/** Agent 虚拟文件系统：read / write 工具（共用 source.json） */

export const VIRTUAL_PATHS = ["source.json"];

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description: "读取虚拟源代码 source.json（含 phoneme_expressions 与 emotion_expressions）。",
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
      name: "write",
      description:
        "写入 source.json 并立即应用到 VisemeSync 编辑器。content 为完整 JSON 字符串，含 phoneme_expressions 与 emotion_expressions。",
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
            description: "JSON 字符串（非 markdown 代码块）",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

export function createToolExecutor(hooks) {
  const vfs = {
    read(path) {
      if (path !== "source.json") {
        throw new Error(`未知路径: ${path}，仅支持 source.json`);
      }
      const doc = hooks.getAgentContext().sourceDoc;
      return JSON.stringify(doc, null, 2);
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
      return `已写入并应用 source.json（${parsed.phoneme_expressions?.length ?? "?"} 音素 + ${parsed.emotion_expressions?.length ?? "?"} 情绪）`;
    },
  };

  return async function executeTool(name, args) {
    if (name === "read") return vfs.read(args.path);
    if (name === "write") return vfs.write(args.path, args.content);
    throw new Error(`未知工具: ${name}`);
  };
}

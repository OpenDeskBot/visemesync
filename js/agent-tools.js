/** Agent 虚拟文件系统：read / write 工具 */

export const VIRTUAL_PATHS = ["design.json"];

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description: "读取虚拟设计文件 design.json（含 name、description、phonemes、emotions）。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: VIRTUAL_PATHS,
            description: "虚拟文件路径，固定为 design.json",
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
        "写入 design.json 并立即应用到 VisemeSync 编辑器。content 为完整 JSON 字符串，含 name、description、phonemes、emotions。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: VIRTUAL_PATHS,
            description: "虚拟文件路径，固定为 design.json",
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
      if (path !== "design.json") {
        throw new Error(`未知路径: ${path}，仅支持 design.json`);
      }
      const doc = hooks.getAgentContext().sourceDoc;
      return JSON.stringify(doc, null, 2);
    },

    write(path, content) {
      if (path !== "design.json") {
        throw new Error(`未知路径: ${path}，仅支持 design.json`);
      }
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new Error(`content 不是合法 JSON: ${e.message || e}`);
      }
      hooks.applySourceDoc(parsed);
      return `已写入并应用 design.json（${parsed.phonemes?.length ?? "?"} 音素 + ${parsed.emotions?.length ?? "?"} 情绪）`;
    },
  };

  return async function executeTool(name, args) {
    if (name === "read") return vfs.read(args.path);
    if (name === "write") return vfs.write(args.path, args.content);
    throw new Error(`未知工具: ${name}`);
  };
}

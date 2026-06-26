/** 项目 ZIP 导出 / 导入（fflate） */

import { normalizeProjectName, projectDesignFilename } from "./project-store.js";

const FFLOAT_URL = "https://esm.sh/fflate@0.8.2?target=es2022";

let fflatePromise = null;

async function fflate() {
  if (!fflatePromise) fflatePromise = import(FFLOAT_URL);
  return fflatePromise;
}

function triggerDownload(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 导出完整项目为 项目名称.zip */
export async function exportProjectZip(project) {
  const { zipSync, strToU8 } = await fflate();
  const projectName = normalizeProjectName(project.projectName);
  const designName = projectDesignFilename(projectName);
  const design = structuredClone(project.design);
  design.name = projectName;

  const files = {
    [designName]: strToU8(JSON.stringify(design, null, 2) + "\n"),
    "project.meta.json": strToU8(
      JSON.stringify(
        {
          version: 1,
          projectName,
          description: project.description || design.description || "",
          canvas: project.canvas,
          currentAgentChat: project.currentAgentChat,
          exportedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    ),
    "agent-chats.json": strToU8(
      JSON.stringify(
        {
          agentChatList: project.agentChatList,
          currentAgentChat: project.currentAgentChat,
        },
        null,
        2,
      ) + "\n",
    ),
  };

  const zipped = zipSync(files);
  triggerDownload(`${projectName}.zip`, new Blob([zipped], { type: "application/zip" }));
}

/** 导出设计文件 项目名称.json */
export function exportDesignJson(project) {
  const projectName = normalizeProjectName(project.projectName);
  const design = structuredClone(project.design);
  design.name = projectName;
  const filename = projectDesignFilename(projectName);
  const blob = new Blob([JSON.stringify(design, null, 2) + "\n"], { type: "application/json" });
  triggerDownload(filename, blob);
}

/** 从 zip 解析项目 */
export async function importProjectZip(file) {
  const { unzipSync, strFromU8 } = await fflate();
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const names = Object.keys(entries);

  let meta = null;
  let agentChats = null;
  let design = null;

  for (const name of names) {
    const text = strFromU8(entries[name]);
    if (name === "project.meta.json") meta = JSON.parse(text);
    else if (name === "agent-chats.json") agentChats = JSON.parse(text);
    else if (name.endsWith(".json") && name !== "project.meta.json" && name !== "agent-chats.json") {
      design = JSON.parse(text);
    }
  }

  if (!design) throw new Error("ZIP 中未找到设计 JSON 文件");
  const projectName = normalizeProjectName(meta?.projectName || design.name || file.name.replace(/\.zip$/i, ""));

  return {
    projectName,
    description: meta?.description || design.description || "",
    design,
    canvas: meta?.canvas || { w: 284, h: 240 },
    agentChatList: agentChats?.agentChatList || [{ id: `chat_${Date.now()}`, title: "对话 1", messages: [] }],
    currentAgentChat: agentChats?.currentAgentChat || agentChats?.agentChatList?.[0]?.id,
  };
}

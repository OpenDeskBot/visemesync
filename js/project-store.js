/** 项目 localStorage 存储 */

const INDEX_KEY = "visemesync.projects.index";
const DATA_PREFIX = "visemesync.projects.data.";
const LEGACY_DESIGN_INDEX = "visemesync.designs.index";
const LEGACY_DESIGN_PREFIX = "visemesync.designs.file.";
const LEGACY_SOURCE_KEY = "visemesync.source";
const LEGACY_CANVAS_KEY = "visemesync.canvas";
const LEGACY_MIGRATED_KEY = "visemesync.projects.legacyMigrated";

export function uid(prefix = "proj") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function chatUid() {
  return uid("chat");
}

export function defaultAgentChats() {
  const id = chatUid();
  return {
    agentChatList: [{ id, title: "对话 1", messages: [] }],
    currentAgentChat: id,
  };
}

/** 项目名称（不含 .json） */
export function normalizeProjectName(input) {
  let name = String(input ?? "").trim();
  if (name.toLowerCase().endsWith(".json")) name = name.slice(0, -5).trim();
  if (name.toLowerCase().endsWith(".zip")) name = name.slice(0, -4).trim();
  name = name.replace(/[^\w\u4e00-\u9fff.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("项目名称不能为空");
  if (!/^[\w\u4e00-\u9fff.-]+$/.test(name)) {
    throw new Error("项目名称仅允许字母、数字、中文、点与横线");
  }
  return name;
}

export function projectDesignFilename(projectName) {
  return `${normalizeProjectName(projectName)}.json`;
}

function loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveIndex(list) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

function dataKey(id) {
  return DATA_PREFIX + id;
}

export function listProjects() {
  migrateLegacyStorage();
  return loadIndex()
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function loadProject(id) {
  const raw = localStorage.getItem(dataKey(id));
  if (!raw) throw new Error("项目不存在");
  const project = JSON.parse(raw);
  if (!project?.id || !project?.projectName) throw new Error("项目数据损坏");
  return normalizeProjectRecord(project);
}

export function loadProjectByName(projectName) {
  const name = normalizeProjectName(projectName);
  const row = listProjects().find((p) => p.projectName === name);
  if (!row) throw new Error(`项目不存在：${name}`);
  return loadProject(row.id);
}

export function normalizeProjectRecord(raw) {
  const agent = raw.agentChatList?.length
    ? {
        agentChatList: structuredClone(raw.agentChatList),
        currentAgentChat: raw.currentAgentChat || raw.agentChatList[0]?.id,
      }
    : defaultAgentChats();

  return {
    id: raw.id,
    projectName: normalizeProjectName(raw.projectName),
    description: raw.description != null ? String(raw.description) : "",
    design: raw.design,
    canvas: raw.canvas || { w: 284, h: 240 },
    agentChatList: agent.agentChatList,
    currentAgentChat: agent.currentAgentChat,
    updatedAt: raw.updatedAt || Date.now(),
  };
}

export function saveProject(project) {
  let id = project.id;
  if (!id && project.projectName) {
    const name = normalizeProjectName(project.projectName);
    const existing = loadIndex().find((row) => row.projectName === name);
    if (existing) id = existing.id;
  }

  const record = normalizeProjectRecord({
    ...project,
    id: id || uid(),
    updatedAt: Date.now(),
  });
  record.design = structuredClone(record.design);
  record.design.name = record.projectName;
  record.description = record.design.description ?? record.description ?? "";

  localStorage.setItem(dataKey(record.id), JSON.stringify(record));

  const index = loadIndex().filter((row) => row.id !== record.id);
  index.push({
    id: record.id,
    projectName: record.projectName,
    description: record.description,
    updatedAt: record.updatedAt,
  });
  saveIndex(index);
  return record;
}

export function copyProject(sourceId, newProjectName) {
  const src = loadProject(sourceId);
  const name = normalizeProjectName(newProjectName);
  if (listProjects().some((p) => p.projectName === name)) {
    throw new Error(`项目名称「${name}」已存在`);
  }
  return saveProject({
    id: uid(),
    projectName: name,
    description: src.description,
    design: structuredClone(src.design),
    canvas: structuredClone(src.canvas),
    agentChatList: structuredClone(src.agentChatList),
    currentAgentChat: src.currentAgentChat,
  });
}

export function copyProjectFromSnapshot(snapshot, newProjectName) {
  const name = normalizeProjectName(newProjectName);
  if (listProjects().some((p) => p.projectName === name)) {
    throw new Error(`项目名称「${name}」已存在`);
  }
  return saveProject({
    id: uid(),
    projectName: name,
    description: snapshot.description,
    design: structuredClone(snapshot.design),
    canvas: structuredClone(snapshot.canvas),
    agentChatList: structuredClone(snapshot.agentChatList),
    currentAgentChat: snapshot.currentAgentChat,
  });
}

export function deleteProject(id) {
  localStorage.removeItem(dataKey(id));
  saveIndex(loadIndex().filter((row) => row.id !== id));
}

/** 删除全部 draft / draft-N 项目 */
export function deleteAllDraftProjects() {
  const drafts = loadIndex().filter((p) => /^draft(-\d+)?$/i.test(p.projectName));
  for (const row of drafts) deleteProject(row.id);
  return drafts.length;
}

/** 删除名称匹配 draft / draft-N 的重复项目，保留最近更新的一条 */
export function cleanupDraftProjects() {
  const drafts = loadIndex()
    .filter((p) => /^draft(-\d+)?$/i.test(p.projectName))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (drafts.length <= 1) return 0;
  const keepId = drafts[0].id;
  let removed = 0;
  for (const row of drafts) {
    if (row.id === keepId) continue;
    deleteProject(row.id);
    removed++;
  }
  return removed;
}

/** 清除旧版 design-store 残留 key（不删项目数据） */
export function purgeLegacyDesignKeys() {
  localStorage.removeItem(LEGACY_DESIGN_INDEX);
  localStorage.removeItem(LEGACY_SOURCE_KEY);
  localStorage.removeItem(LEGACY_CANVAS_KEY);
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LEGACY_DESIGN_PREFIX)) toRemove.push(key);
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}

export function formatUpdatedAt(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function migrateLegacyStorage() {
  if (localStorage.getItem(LEGACY_MIGRATED_KEY)) return;

  try {
    const legacyIdx = localStorage.getItem(LEGACY_DESIGN_INDEX);
    if (!legacyIdx) {
      purgeLegacyDesignKeys();
      localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
      return;
    }

    const rows = JSON.parse(legacyIdx);
    if (!Array.isArray(rows) || !rows.length) {
      purgeLegacyDesignKeys();
      localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
      return;
    }

    const usedNames = new Set(loadIndex().map((p) => p.projectName));

    for (const row of rows) {
      if (!row?.filename) continue;
      const raw = localStorage.getItem(LEGACY_DESIGN_PREFIX + row.filename);
      if (!raw) continue;
      const payload = JSON.parse(raw);
      const base = row.filename.replace(/\.json$/i, "") || "project";
      let projectName = base;
      let n = 1;
      while (usedNames.has(projectName)) {
        projectName = `${base}-${n++}`;
      }
      usedNames.add(projectName);
      saveProject({
        id: uid(),
        projectName,
        description: payload.doc?.description || row.description || "",
        design: payload.doc,
        canvas: payload.canvas,
        ...defaultAgentChats(),
      });
    }

    purgeLegacyDesignKeys();
    localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
  } catch {
    /* 标记已尝试，避免每次 listProjects 重复触发 */
    localStorage.setItem(LEGACY_MIGRATED_KEY, "1");
  }
}

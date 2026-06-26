import {
  DEFAULT_CANVAS,
  DEFAULT_FACE,
  defaultPhonemeExpression,
  defaultPhonemeDoc,
  defaultFrame,
  defaultExpression,
  readJsonFile,
  validatePhonemeDoc,
  validateScenesDoc,
  findExpressionKeyConflicts,
  formatExpressionConflictError,
  normalizeExpression,
  formatExpressionJson,
  expressionMatchKeys,
  validateSourceDoc,
  defaultSourceDoc,
} from "./data-models.js";
import {
  LAYER_LABELS,
  SHAPE_TYPES,
  PALETTE_COLORS,
  defaultShapeAt,
  drawFace,
  drawShape,
  hitTest,
  hitTestHandle,
  dragShapeHandle,
  moveShape,
  rgb565ToCss,
  rgb565ToHex,
  hexToRgb565,
  quantizeColor256,
  scaleShape,
  getShapeBounds,
  boundsIntersect,
  snapRotationAngle,
  normalizeShapeAngle,
} from "./oled-renderer.js";
import { showToast } from "./toast.js";
import { initSourceEditor } from "./source-editor.js";
import { renderJsonTree } from "./json-tree.js";
import { sampleSceneAt, sceneTotalDuration } from "./frame-interpolation.js";
import { buildSourceDoc } from "./agent-prompt.js";
import { applySourceDoc } from "./data-models.js";
import { initAgentPanel } from "./agent-panel.js";
import { createProjectPicker } from "./project-picker.js";
import {
  saveProject,
  copyProject,
  copyProjectFromSnapshot,
  normalizeProjectName,
  projectDesignFilename,
  defaultAgentChats,
  listProjects,
} from "./project-store.js";
import { createProjectNameDialog } from "./project-name-dialog.js";
import { exportProjectZip, exportDesignJson } from "./project-export.js";
import { createEditHistory } from "./edit-history.js";

const SCENE_LAYERS = ["mouth", "eye_l", "eye_r", "nose", "extra"];
const DRAG_MIME = "application/x-viseme-shape";
const MIN_FRAME_MS = 16;
const MS_PER_PX = 8;
const GAP_MIN_PX = 32;
const PLAY_TICK_MS = 13;
const CANVAS_DISPLAY_SCALE = 2;

const state = {
  tab: "phoneme",
  canvas: { ...DEFAULT_CANVAS },
  docName: "",
  docDescription: "",
  projectId: null,
  projectName: null,
  catalogFile: null,
  readOnly: false,
  phonemeExpressions: [],
  emotionExpressions: [],
  selectedPhonemeIdx: 0,
  selectedEmotionIdx: 0,
  selectedFrameIdx: 0,
  editLayer: "mouth",
  selectedColor: 65535,
  selection: { items: [] },
  drag: null,
  marquee: null,
  clipboard: null,
  gapDrag: null,
  playback: null,
  jsonEditorMode: "json",
  jsonEditorDirty: false,
  sourceEditorDirty: false,
  status: "",
};

const els = {};
let sourceEditorUi = null;
let agentPanel = null;
let projectPicker = null;
let projectNameDialog = null;
let autosaveTimer = null;
const editHistory = createEditHistory();

function captureEditSnapshot() {
  return {
    docName: state.docName,
    docDescription: state.docDescription,
    phonemeExpressions: structuredClone(state.phonemeExpressions),
    emotionExpressions: structuredClone(state.emotionExpressions),
    canvas: { ...state.canvas },
    selectedPhonemeIdx: state.selectedPhonemeIdx,
    selectedEmotionIdx: state.selectedEmotionIdx,
    selectedFrameIdx: state.selectedFrameIdx,
    selection: structuredClone(state.selection),
    editLayer: state.editLayer,
    selectedColor: state.selectedColor,
  };
}

function restoreEditSnapshot(snap) {
  stopScenePlayback();
  state.docName = snap.docName;
  state.docDescription = snap.docDescription;
  state.phonemeExpressions = snap.phonemeExpressions;
  state.emotionExpressions = snap.emotionExpressions;
  state.canvas = { ...snap.canvas };
  state.selectedPhonemeIdx = snap.selectedPhonemeIdx;
  state.selectedEmotionIdx = snap.selectedEmotionIdx;
  state.selectedFrameIdx = snap.selectedFrameIdx;
  state.selection = structuredClone(snap.selection);
  if (snap.editLayer != null) state.editLayer = snap.editLayer;
  if (snap.selectedColor != null) state.selectedColor = snap.selectedColor;
  state.jsonEditorDirty = false;
  state.sourceEditorDirty = false;
  if (els.canvasW) els.canvasW.value = state.canvas.w;
  if (els.canvasH) els.canvasH.value = state.canvas.h;
  if (els.layerSelect) els.layerSelect.value = state.editLayer;
  clampSelectedIndices();
  checkExpressionConflicts(state.phonemeExpressions, false);
  checkExpressionConflicts(state.emotionExpressions, false);
  renderAll();
  scheduleAutosave();
}

function updateUndoRedoButtons() {
  const ro = state.readOnly;
  if (els.btnUndo) els.btnUndo.disabled = ro || !editHistory.canUndo();
  if (els.btnRedo) els.btnRedo.disabled = ro || !editHistory.canRedo();
}

function pushUndo() {
  if (state.readOnly) return;
  editHistory.push(captureEditSnapshot());
  updateUndoRedoButtons();
}

function clearEditHistory() {
  editHistory.clear();
  updateUndoRedoButtons();
}

function undoEdit() {
  if (state.readOnly || !editHistory.canUndo()) return false;
  const prev = editHistory.undo(captureEditSnapshot());
  if (prev) restoreEditSnapshot(prev);
  updateUndoRedoButtons();
  showToast("已撤销", "success");
  return true;
}

function redoEdit() {
  if (state.readOnly || !editHistory.canRedo()) return false;
  const next = editHistory.redo(captureEditSnapshot());
  if (next) restoreEditSnapshot(next);
  updateUndoRedoButtons();
  showToast("已重做", "success");
  return true;
}

function scheduleAutosave() {
  if (state.readOnly || !state.projectId || !state.projectName) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosaveProjectIfNeeded(true), 400);
}

function getAgentContext() {
  const tab = state.tab;
  const phonemeList = state.phonemeExpressions;
  const emotionList = state.emotionExpressions;
  const list = tab === "phoneme" ? phonemeList : tab === "scene" ? emotionList : null;
  const idx =
    tab === "phoneme" ? state.selectedPhonemeIdx : tab === "scene" ? state.selectedEmotionIdx : -1;
  return {
    tab,
    canvas: state.canvas,
    currentExpression: list?.[idx],
    selectedIndex: idx,
    phonemeCount: phonemeList.length,
    emotionCount: emotionList.length,
    sourceDoc: buildSourceDoc(state.phonemeExpressions, state.emotionExpressions, {
      name: state.docName,
      description: state.docDescription,
    }),
    docName: state.docName,
    docDescription: state.docDescription,
  };
}

function clampSelectedIndices() {
  if (state.phonemeExpressions.length) {
    state.selectedPhonemeIdx = Math.max(
      0,
      Math.min(state.selectedPhonemeIdx, state.phonemeExpressions.length - 1),
    );
  } else {
    state.selectedPhonemeIdx = 0;
  }
  if (state.emotionExpressions.length) {
    state.selectedEmotionIdx = Math.max(
      0,
      Math.min(state.selectedEmotionIdx, state.emotionExpressions.length - 1),
    );
  } else {
    state.selectedEmotionIdx = 0;
  }
  clampFrameIdx();
}

function applySourceDocToState(doc, meta = {}) {
  const validated = validateSourceDoc(doc);
  state.docName = validated.name;
  state.docDescription = validated.description;
  state.phonemeExpressions = validated.phonemes;
  state.emotionExpressions = validated.emotions;

  if (meta.canvas) {
    state.canvas = { ...DEFAULT_CANVAS, ...meta.canvas };
    if (els.canvasW) els.canvasW.value = state.canvas.w;
    if (els.canvasH) els.canvasH.value = state.canvas.h;
  }

  state.jsonEditorDirty = false;
  state.sourceEditorDirty = false;
  clampSelectedIndices();
  checkExpressionConflicts(state.phonemeExpressions, true);
  checkExpressionConflicts(state.emotionExpressions, true);
  syncDocMetaForm();
  syncDesignUi();
  if (!meta.isOpen) autosaveProjectIfNeeded(true);
}

function applyAgentSource(doc, meta) {
  pushUndo();
  applySourceDocToState(doc, meta);
  renderAll();
}

function syncDocMetaForm() {
  if (els.docName) els.docName.value = state.docName;
  if (els.docDescription) els.docDescription.value = state.docDescription;
}

function applyDocMetaFromForm() {
  if (els.docName) state.docName = els.docName.value.trim() || state.projectName || "未命名设计";
  if (els.docDescription) state.docDescription = els.docDescription.value.trim();
}

function collectProjectSnapshot() {
  const design = validateDocForSave();
  if (!design) return null;
  design.name = state.projectName || state.docName || design.name;
  design.description = state.docDescription;
  const agent = agentPanel?.getAgentState?.() || defaultAgentChats();
  return {
    id: state.projectId,
    projectName: state.projectName || state.docName || design.name,
    description: state.docDescription,
    design,
    canvas: { ...state.canvas },
    agentChatList: agent.agentChatList,
    currentAgentChat: agent.currentAgentChat,
  };
}

function openProjectRecord(project, { readOnly = false } = {}) {
  state.projectId = readOnly ? null : project.id;
  state.projectName = project.projectName;
  state.readOnly = readOnly;
  state.catalogFile = null;
  state.docName = project.design?.name ?? project.projectName;
  state.docDescription = project.description ?? project.design?.description ?? "";

  applySourceDocToState(project.design, {
    isOpen: true,
    canvas: project.canvas,
  });

  if (state.projectName) {
    state.docName = state.projectName;
    if (els.docName) els.docName.value = state.projectName;
  }

  agentPanel?.loadAgentState({
    agentChatList: project.agentChatList,
    currentAgentChat: project.currentAgentChat,
  });

  syncDesignUi();
  clearEditHistory();
  renderAll();
  setStatus(readOnly ? `已打开内置模板（只读）：${project.projectName}` : `已打开项目：${project.projectName}`);
  showToast(readOnly ? `已打开内置模板（只读）` : `已打开项目：${project.projectName}`, "success");
}

function createProjectFromCatalog(projectName, doc, catalogItem) {
  const name = assertProjectNameAvailable(projectName);
  const design = validateSourceDoc(structuredClone(doc));
  design.name = name;
  const agent = defaultAgentChats();
  const saved = saveProject({
    projectName: name,
    description: design.description || catalogItem?.description || "",
    design,
    canvas: { ...DEFAULT_CANVAS },
    agentChatList: agent.agentChatList,
    currentAgentChat: agent.currentAgentChat,
  });
  pendingCatalogDoc = null;
  pendingCatalogItem = null;
  openProjectRecord(saved);
}

function beginCatalogProject(doc, catalogItem) {
  pendingCatalogDoc = doc;
  pendingCatalogItem = catalogItem;
  const base = catalogItem.file.replace(/\.json$/i, "") || catalogItem.name || "project";
  openProjectNameDialog("fromCatalog", {
    title: "从内置模板创建项目",
    hint: `基于「${catalogItem.name}」创建本地项目，请输入项目名称`,
    defaultName: base,
    confirmText: "创建",
  });
}

function handleDeleteProject(id) {
  if (state.projectId === id) {
    state.projectId = null;
    state.projectName = null;
    state.readOnly = false;
    state.catalogFile = null;
    setStatus("当前项目已删除");
    showToast("当前项目已删除", "success");
  } else {
    showToast("已删除项目", "success");
  }
}

function syncDesignUi() {
  if (els.docFileLabel) {
    if (state.readOnly && state.catalogFile) {
      els.docFileLabel.textContent = `内置模板 · ${state.catalogFile}（只读）`;
    } else if (state.projectId && state.projectName) {
      els.docFileLabel.textContent = `项目 · ${state.projectName} · ${projectDesignFilename(state.projectName)}`;
    } else if (state.projectName && !state.projectId) {
      els.docFileLabel.textContent = `${state.projectName}（未保存）`;
    } else {
      els.docFileLabel.textContent = "";
    }
  }
  if (els.docReadonlyBadge) {
    els.docReadonlyBadge.classList.toggle("hidden", !state.readOnly);
  }
  if (els.btnSaveDesign) {
    els.btnSaveDesign.disabled = state.readOnly;
    els.btnSaveDesign.title = state.readOnly
      ? "内置模板不可改写，请使用「另存为」"
      : "保存整个项目到 localStorage";
  }
}

function validateDocForSave() {
  if ((state.tab === "phoneme" || state.tab === "scene") && !applyExpressionMetaFromForm()) {
    return null;
  }
  applyDocMetaFromForm();
  const doc = validateSourceDoc(getSourceDocObject());
  const phDups = findExpressionKeyConflicts(doc.phonemes);
  const emDups = findExpressionKeyConflicts(doc.emotions);
  if (phDups.length) {
    showToast(formatExpressionConflictError(phDups, doc.phonemes), "error");
    return null;
  }
  if (emDups.length) {
    showToast(formatExpressionConflictError(emDups, doc.emotions), "error");
    return null;
  }
  return doc;
}

function autosaveProjectIfNeeded(silent = true) {
  if (state.readOnly || !state.projectId || !state.projectName) return false;
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  const saved = saveProject(snap);
  state.projectId = saved.id;
  if (!silent) {
    setStatus(`已保存项目 ${saved.projectName}`);
    showToast(`已保存项目 ${saved.projectName}`, "success");
  }
  syncDesignUi();
  return true;
}

function saveCurrentProject() {
  if (state.readOnly) {
    showToast("内置模板不可改写，请使用「另存为」", "error");
    return false;
  }
  if (!state.projectId || !state.projectName) {
    openProjectNameDialog("save");
    return false;
  }
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  const saved = saveProject(snap);
  state.projectId = saved.id;
  state.readOnly = false;
  setStatus(`已保存项目 ${saved.projectName}`);
  showToast(`已保存项目 ${saved.projectName}`, "success");
  syncDesignUi();
  return true;
}

function saveAsProject(newProjectName) {
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  const name = normalizeProjectName(newProjectName);
  let saved;
  if (state.projectId && !state.readOnly) {
    saved = copyProject(state.projectId, name);
  } else {
    saved = copyProjectFromSnapshot(snap, name);
  }
  state.projectId = saved.id;
  state.projectName = saved.projectName;
  state.readOnly = false;
  state.catalogFile = null;
  state.docName = saved.projectName;
  state.docDescription = saved.description;
  syncDocMetaForm();
  syncDesignUi();
  renderAll();
  setStatus(`已另存为项目 ${saved.projectName}`);
  showToast(`已另存为项目 ${saved.projectName}`, "success");
  return true;
}

function assertProjectNameAvailable(projectName, existingId = null) {
  const name = normalizeProjectName(projectName);
  const taken = listProjects().some((p) => p.projectName === name && p.id !== existingId);
  if (taken) throw new Error(`项目名称「${name}」已存在`);
  return name;
}

function saveProjectWithName(projectName) {
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  snap.projectName = assertProjectNameAvailable(projectName, state.projectId);
  snap.id = state.projectId || undefined;
  const saved = saveProject(snap);
  state.projectId = saved.id;
  state.projectName = saved.projectName;
  state.readOnly = false;
  state.catalogFile = null;
  state.docName = saved.projectName;
  syncDocMetaForm();
  syncDesignUi();
  setStatus(`已保存项目 ${saved.projectName}`);
  showToast(`已保存项目 ${saved.projectName}`, "success");
  return true;
}

function createNewProject(projectName) {
  const name = assertProjectNameAvailable(projectName);
  const design = defaultSourceDoc();
  design.name = name;
  design.description = "";
  const agent = defaultAgentChats();
  const saved = saveProject({
    projectName: name,
    description: "",
    design,
    canvas: { ...DEFAULT_CANVAS },
    agentChatList: agent.agentChatList,
    currentAgentChat: agent.currentAgentChat,
  });
  openProjectRecord(saved);
}

function importJsonAsProject(doc, suggestedName) {
  pendingProjectNameAction = "import";
  pendingImportDoc = doc;
  projectNameDialog?.open({
    title: "导入为项目",
    hint: "为导入的设计命名，将保存完整项目到 localStorage",
    defaultName: suggestedName,
    confirmText: "创建项目",
  });
}

function importZipAsProject(payload) {
  const agent = defaultAgentChats();
  const saved = saveProject({
    projectName: payload.projectName,
    description: payload.description,
    design: payload.design,
    canvas: payload.canvas,
    agentChatList: payload.agentChatList?.length ? payload.agentChatList : agent.agentChatList,
    currentAgentChat: payload.currentAgentChat || agent.currentAgentChat,
  });
  openProjectRecord(saved);
}

let pendingProjectNameAction = "saveAs";
let pendingImportDoc = null;
let pendingCatalogDoc = null;
let pendingCatalogItem = null;

function openProjectNameDialog(mode = "save", options = {}) {
  pendingProjectNameAction = mode;
  if (mode !== "import") pendingImportDoc = null;
  const isSaveAs = mode === "saveAs" || state.readOnly || (mode === "save" && !state.projectId);
  const defaults = {
    title:
      mode === "fromCatalog"
        ? "从内置模板创建项目"
        : isSaveAs
          ? "另存为项目"
          : mode === "new"
            ? "新建项目"
            : "保存项目",
    hint: "输入项目名称（不含 .json），将保存设计文件与 Agent 对话到 localStorage",
    defaultName: state.projectName || state.docName || "my-project",
    confirmText: mode === "new" || mode === "fromCatalog" ? "创建" : isSaveAs ? "另存为" : "保存",
  };
  projectNameDialog?.open({ ...defaults, ...options });
}

function openSaveAsDialog() {
  openProjectNameDialog("saveAs");
}

function handleProjectNameConfirm(projectName) {
  if (pendingProjectNameAction === "new") {
    createNewProject(projectName);
  } else if (pendingProjectNameAction === "save") {
    saveProjectWithName(projectName);
  } else if (pendingProjectNameAction === "fromCatalog" && pendingCatalogDoc) {
    createProjectFromCatalog(projectName, pendingCatalogDoc, pendingCatalogItem);
  } else if (pendingProjectNameAction === "import" && pendingImportDoc) {
    const name = assertProjectNameAvailable(projectName);
    const design = validateSourceDoc(pendingImportDoc);
    design.name = name;
    const agent = defaultAgentChats();
    const saved = saveProject({
      projectName: name,
      description: design.description || "",
      design,
      canvas: { ...DEFAULT_CANVAS },
      agentChatList: agent.agentChatList,
      currentAgentChat: agent.currentAgentChat,
    });
    pendingImportDoc = null;
    openProjectRecord(saved);
  } else {
    saveAsProject(projectName);
  }
}

async function exportCurrentProjectZip() {
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  const name = snap.projectName || normalizeProjectName(state.docName || "project");
  await exportProjectZip({ ...snap, projectName: name });
  setStatus(`已导出项目 ${name}.zip`);
  showToast(`已导出项目 ${name}.zip`, "success");
  return true;
}

function exportCurrentDesignJson() {
  const snap = collectProjectSnapshot();
  if (!snap) return false;
  const name = snap.projectName || normalizeProjectName(state.docName || "project");
  exportDesignJson({ ...snap, projectName: name });
  setStatus(`已导出设计文件 ${projectDesignFilename(name)}`);
  showToast(`已导出 ${projectDesignFilename(name)}`, "success");
  return true;
}

/** 离开源码 Tab 前将编辑器内容同步到音素/情绪数据 */
function applySourceEditorIfDirty() {
  if (!state.sourceEditorDirty || !els.sourceEditor) return true;
  try {
    pushUndo();
    applySourceDocToState(JSON.parse(els.sourceEditor.value));
    return true;
  } catch (e) {
    showToast(`源码无效，无法同步: ${e.message || e}`, "error");
    return false;
  }
}

async function loadInitialSource() {
  /* 由项目选择器在 boot 时加载，此处保留空实现供兼容 */
}

function getSourceDocObject() {
  return buildSourceDoc(state.phonemeExpressions, state.emotionExpressions, {
    name: state.docName,
    description: state.docDescription,
  });
}

function getSourceDocText() {
  return JSON.stringify(getSourceDocObject(), null, 2);
}

function exportSourceFile() {
  return exportCurrentDesignJson();
}

async function importSourceFile(file) {
  try {
    const doc = validateSourceDoc(await readJsonFile(file));
    const base = file.name.replace(/\.json$/i, "") || "project";
    importJsonAsProject(doc, base);
  } catch (e) {
    setStatus(String(e.message || e), true);
    showToast(String(e.message || e), "error");
  }
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, isErr = false) {
  state.status = msg;
  if (els.status) {
    els.status.textContent = msg;
    els.status.classList.toggle("err", isErr);
  }
}

function getCurrentExpression() {
  if (state.tab === "phoneme") return state.phonemeExpressions[state.selectedPhonemeIdx];
  if (state.tab === "scene") return state.emotionExpressions[state.selectedEmotionIdx];
  return null;
}

function setCurrentExpression(expr) {
  if (state.tab === "phoneme") state.phonemeExpressions[state.selectedPhonemeIdx] = expr;
  else if (state.tab === "scene") state.emotionExpressions[state.selectedEmotionIdx] = expr;
}

function getCurrentExpressionList() {
  if (state.tab === "phoneme") return state.phonemeExpressions;
  if (state.tab === "scene") return state.emotionExpressions;
  return [];
}

function getCurrentFrame() {
  const expr = getCurrentExpression();
  return expr?.frames?.[state.selectedFrameIdx];
}

function effectiveAddLayer() {
  return state.editLayer;
}

function isLayerEditable(layer) {
  if (state.tab === "phoneme" || state.tab === "scene") return layer === state.editLayer;
  return true;
}

function getLockedLayers() {
  if (state.tab === "phoneme" || state.tab === "scene") {
    return SCENE_LAYERS.filter((l) => l !== state.editLayer);
  }
  return [];
}

function getEditableLayers() {
  if (state.tab === "phoneme" || state.tab === "scene") return [state.editLayer];
  return SCENE_LAYERS;
}

function pruneSelection() {
  state.selection.items = state.selection.items.filter(
    (i) => isLayerEditable(i.layer) && getShapeByRef(i) != null,
  );
}

function syncLayerUi() {
  if (els.layerSelect) {
    els.layerSelect.disabled = false;
    els.layerSelect.value = state.editLayer;
    els.layerSelect.title = "仅当前图层可编辑，其他图层显示遮光罩";
  }
  if (els.layerLockHint) {
    const editable = LAYER_LABELS[state.editLayer] || state.editLayer;
    const locked = getLockedLayers();
    els.layerLockHint.textContent =
      locked.length > 0
        ? `仅编辑：${editable} · 其余 ${locked.length} 个图层已锁定（遮光）`
        : `当前图层：${editable}`;
  }
}

function currentElements() {
  const fr = getCurrentFrame();
  return fr?.elements || DEFAULT_FACE;
}

function editableElements() {
  const expr = getCurrentExpression();
  if (!expr) return null;
  if (!expr.frames?.length) expr.frames = [defaultFrame()];
  clampFrameIdx();
  const fr = expr.frames[state.selectedFrameIdx];
  if (!fr.elements) fr.elements = structuredClone(DEFAULT_FACE);
  return fr.elements;
}

function getLayerList(layer) {
  const el = editableElements();
  if (!el) return null;
  return el[layer];
}

function clearSelection() {
  state.selection = { items: [] };
}

function setSelection(items) {
  state.selection = { items: [...items] };
}

function isShapeSelected(layer, index) {
  return state.selection.items.some((i) => i.layer === layer && i.index === index);
}

function selectableLayers() {
  return getEditableLayers();
}

function getShapeByRef({ layer, index }) {
  return getLayerList(layer)?.[index] ?? null;
}

function getPrimarySelectionRef() {
  if (state.selection.items.length !== 1) return null;
  const item = state.selection.items[0];
  if (!isLayerEditable(item.layer)) return null;
  const list = getLayerList(item.layer);
  if (!list || list[item.index] == null) return null;
  return { list, index: item.index, layer: item.layer };
}

function getSelectedShapeRef() {
  return getPrimarySelectionRef();
}

function findShapesInRect(rect) {
  const box = {
    x: Math.min(rect.x0, rect.x1),
    y: Math.min(rect.y0, rect.y1),
    w: Math.abs(rect.x1 - rect.x0),
    h: Math.abs(rect.y1 - rect.y0),
  };
  const items = [];
  for (const layer of selectableLayers()) {
    const list = getLayerList(layer) || [];
    list.forEach((shape, index) => {
      if (boundsIntersect(box, getShapeBounds(shape))) items.push({ layer, index });
    });
  }
  return items;
}

function moveSelectedShapes(dx, dy) {
  if (!state.selection.items.length) return;
  pushUndo();
  for (const item of state.selection.items) {
    const shape = getShapeByRef(item);
    if (shape) moveShape(shape, dx, dy);
  }
  renderCanvas();
  if (!state.jsonEditorDirty) renderJsonEditor();
}

function getCurrentScene() {
  return getCurrentExpression();
}

function clampFrameIdx() {
  const expr = getCurrentExpression();
  if (!expr?.frames?.length) {
    state.selectedFrameIdx = 0;
    return;
  }
  state.selectedFrameIdx = Math.max(0, Math.min(state.selectedFrameIdx, expr.frames.length - 1));
}

function msToGapWidth(ms) {
  return Math.max(GAP_MIN_PX, Math.round((ms ?? 800) / MS_PER_PX));
}

function frameGapLabel(idx, totalFrames) {
  if (totalFrames === 1) return "展示";
  if (idx < totalFrames - 1) return "→ 下一帧";
  return "停顿";
}

function drawFrameThumb(canvas, elements) {
  canvas.width = state.canvas.w;
  canvas.height = state.canvas.h;
  drawFace(canvas.getContext("2d"), elements || DEFAULT_FACE, {
    width: state.canvas.w,
    height: state.canvas.h,
    showGrid: false,
  });
}

function refreshPlayPreview() {
  if (!els.playCanvas) return;
  const sc = getCurrentScene();
  const frames = sc?.frames;
  if (!frames?.length) {
    drawFrameThumb(els.playCanvas, DEFAULT_FACE);
    if (els.playTimeLabel) els.playTimeLabel.textContent = "无帧";
    return;
  }
  if (state.playback?.active) return;

  const fr = frames[state.selectedFrameIdx] ?? frames[0];
  drawFrameThumb(els.playCanvas, fr?.elements);
  const total = sceneTotalDuration(frames);
  if (els.playTimeLabel) {
    els.playTimeLabel.textContent = `帧 ${state.selectedFrameIdx + 1}/${frames.length} · ${fr?.ms ?? 0} ms · 总长 ${total} ms`;
  }
}

function stopScenePlayback() {
  if (state.playback?.timer) clearInterval(state.playback.timer);
  state.playback = null;
  els.btnStopPlay?.classList.add("hidden");
  els.playPreview?.classList.remove("is-playing");
  refreshPlayPreview();
}

function tickScenePlayback() {
  const sc = getCurrentScene();
  if (!state.playback?.active || !sc?.frames?.length || !els.playCanvas) return;
  const elapsed = performance.now() - state.playback.startTime;
  const elements = sampleSceneAt(sc.frames, elapsed);
  const canvas = els.playCanvas;
  canvas.width = state.canvas.w;
  canvas.height = state.canvas.h;
  drawFace(canvas.getContext("2d"), elements, {
    width: state.canvas.w,
    height: state.canvas.h,
    showGrid: false,
  });
  const total = sceneTotalDuration(sc.frames);
  const t = total > 0 ? Math.round(((elapsed % total) + total) % total) : 0;
  if (els.playTimeLabel) els.playTimeLabel.textContent = `${t} / ${total} ms`;
}

function startScenePlayback() {
  const sc = getCurrentScene();
  if (!sc?.frames?.length) {
    showToast("无帧可播放", "error");
    return;
  }
  stopScenePlayback();
  state.playback = { active: true, startTime: performance.now() };
  els.btnStopPlay?.classList.remove("hidden");
  els.playPreview?.classList.add("is-playing");
  tickScenePlayback();
  state.playback.timer = setInterval(tickScenePlayback, PLAY_TICK_MS);
}

function selectFrame(idx) {
  const sc = getCurrentScene();
  if (!sc?.frames?.length) return;
  const next = Math.max(0, Math.min(idx, sc.frames.length - 1));
  if (next === state.selectedFrameIdx) return;
  state.selectedFrameIdx = next;
  clearSelection();
  renderAll();
}

function addSceneFrame() {
  const sc = getCurrentScene();
  if (!sc) return;
  pushUndo();
  if (!sc.frames) sc.frames = [];
  const cur = sc.frames[state.selectedFrameIdx];
  sc.frames.push(defaultFrame(cur?.elements || DEFAULT_FACE, cur?.ms ?? 800));
  state.selectedFrameIdx = sc.frames.length - 1;
  clearSelection();
  renderAll();
  showToast(`已添加第 ${sc.frames.length} 帧`, "success");
}

function deleteSceneFrame() {
  const sc = getCurrentScene();
  if (!sc?.frames || sc.frames.length <= 1) {
    showToast("至少保留 1 帧", "error");
    return;
  }
  pushUndo();
  sc.frames.splice(state.selectedFrameIdx, 1);
  state.selectedFrameIdx = Math.max(0, state.selectedFrameIdx - 1);
  clearSelection();
  renderAll();
  showToast("已删除当前帧", "success");
}

function renderFrameTimeline() {
  const panel = els.frameTimeline;
  const track = els.frameTrack;
  if (!panel || !track) return;

  const show = state.tab === "phoneme" || state.tab === "scene";
  panel.classList.toggle("hidden", !show);
  if (!show) return;

  clampFrameIdx();
  const sc = getCurrentScene();
  if (!sc?.frames?.length) {
    track.innerHTML = `<p class="muted">无帧数据</p>`;
    return;
  }

  track.innerHTML = "";
  const frames = sc.frames;
  const totalMs = sceneTotalDuration(frames);

  frames.forEach((fr, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "frame-card" + (idx === state.selectedFrameIdx ? " active" : "");
    card.title = `帧 ${idx + 1}`;

    const cv = document.createElement("canvas");
    cv.className = "frame-thumb";
    drawFrameThumb(cv, fr.elements);

    const label = document.createElement("span");
    label.className = "frame-label";
    label.textContent = `${idx + 1}`;

    card.appendChild(cv);
    card.appendChild(label);
    card.onclick = () => selectFrame(idx);
    track.appendChild(card);

    const gap = document.createElement("div");
    gap.className = "frame-gap" + (idx === frames.length - 1 ? " hold" : "");
    gap.dataset.gapIdx = String(idx);
    gap.style.width = `${msToGapWidth(fr.ms)}px`;

    const gapInner = document.createElement("div");
    gapInner.className = "frame-gap-inner";

    const gapLabel = document.createElement("span");
    gapLabel.className = "frame-gap-label";
    gapLabel.textContent = `${fr.ms ?? 800}ms`;

    const gapHint = document.createElement("span");
    gapHint.className = "frame-gap-hint";
    gapHint.textContent = frameGapLabel(idx, frames.length);

    const handle = document.createElement("div");
    handle.className = "frame-gap-handle";
    handle.title = "拖动调节时长";

    gapInner.appendChild(gapLabel);
    gapInner.appendChild(gapHint);
    gap.appendChild(gapInner);
    gap.appendChild(handle);

    handle.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      pushUndo();
      state.gapDrag = {
        frameIdx: idx,
        startX: ev.clientX,
        startMs: fr.ms ?? 800,
      };
    });

    track.appendChild(gap);
  });

  if (els.frameTotalMs) els.frameTotalMs.textContent = `${totalMs} ms`;
  const fr = frames[state.selectedFrameIdx];
  if (els.frameMs) els.frameMs.value = fr?.ms ?? 800;
  if (els.btnDelFrame) {
    els.btnDelFrame.disabled = frames.length <= 1;
  }
}

function expressionListLabel(expr, idx) {
  const keys = expressionMatchKeys(expr);
  const keyStr = keys.slice(0, 4).join(", ") + (keys.length > 4 ? " …" : "");
  const title = expr?.title || expr?.name || `#${idx + 1}`;
  return title === keyStr ? title : `${title} · ${keyStr}`;
}

function checkExpressionConflicts(list, showMsg = true) {
  const dups = findExpressionKeyConflicts(list);
  if (dups.length && showMsg) {
    showToast(formatExpressionConflictError(dups, list), "error");
  }
  return dups;
}

function checkCurrentListConflicts(showMsg = true) {
  return checkExpressionConflicts(getCurrentExpressionList(), showMsg);
}

function applyExpressionMetaFromForm() {
  const expr = getCurrentExpression();
  if (!expr) return false;
  const fields =
    state.tab === "phoneme"
      ? { name: els.pName, title: els.pTitle, alias: els.pAlias }
      : { name: els.eName, title: els.eTitle, alias: els.eAlias };
  const prev = structuredClone(expr);
  const name = fields.name?.value?.trim();
  const title = fields.title?.value?.trim();
  const aliasRaw = fields.alias?.value || "";
  const alias = aliasRaw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (name) expr.name = name;
  if (title != null) expr.title = title || name || expr.name;
  expr.alias = alias;
  const dups = checkCurrentListConflicts(false);
  if (dups.length) {
    Object.assign(expr, prev);
    showToast(formatExpressionConflictError(dups, getCurrentExpressionList()), "error");
    renderExpressionMeta();
    return false;
  }
  state.jsonEditorDirty = false;
  return true;
}

function setSelectedColor(c) {
  const q = quantizeColor256(c);
  state.selectedColor = q;
  renderColorPalette();
  if (els.colorCustomInput) els.colorCustomInput.value = rgb565ToHex(q);
  if (els.colorCustomLabel) {
    els.colorCustomLabel.textContent = `${rgb565ToHex(q)} · ${q}`;
  }
  if (state.selection.items.length) {
    pushUndo();
    for (const item of state.selection.items) {
      const shape = getShapeByRef(item);
      if (shape) shape.c = q;
    }
    renderCanvas();
    renderProps();
  } else {
    renderShapePalette();
  }
}

function addShapeAt(type, x, y, layer = effectiveAddLayer()) {
  const list = getLayerList(layer);
  if (!list) {
    showToast("当前模式下无法添加到该图层", "error");
    return null;
  }
  pushUndo();
  const shape = defaultShapeAt(type, layer, x, y, state.selectedColor);
  normalizeShapeAngle(shape);
  list.push(shape);
  setSelection([{ layer, index: list.length - 1 }]);
  renderAll();
  return shape;
}

function deleteSelectedShapes() {
  if (!state.selection.items.length) return false;
  pushUndo();
  const byLayer = {};
  for (const item of state.selection.items) {
    (byLayer[item.layer] ||= new Set()).add(item.index);
  }
  for (const [layer, idxSet] of Object.entries(byLayer)) {
    const list = getLayerList(layer);
    if (!list) continue;
    [...idxSet].sort((a, b) => b - a).forEach((i) => list.splice(i, 1));
  }
  clearSelection();
  renderAll();
  showToast("已删除图元", "success");
  return true;
}

function deleteSelectedShape() {
  return deleteSelectedShapes();
}

function copySelectedShapes() {
  if (!state.selection.items.length) return false;
  state.clipboard = {
    shapes: state.selection.items.map((item) => ({
      layer: item.layer,
      data: structuredClone(getShapeByRef(item)),
    })),
  };
  const n = state.clipboard.shapes.length;
  showToast(n > 1 ? `已复制 ${n} 个图元` : "已复制图元", "success");
  return true;
}

function copySelectedShape() {
  return copySelectedShapes();
}

function pasteShape() {
  if (!state.clipboard?.shapes?.length) {
    showToast("剪贴板为空", "error");
    return false;
  }
  pushUndo();
  const newItems = [];
  for (const entry of state.clipboard.shapes) {
    const layer = entry.layer || effectiveAddLayer();
    const list = getLayerList(layer);
    if (!list) continue;
    const shape = structuredClone(entry.data);
    normalizeShapeAngle(shape);
    if (shape.c != null) shape.c = quantizeColor256(shape.c);
    moveShape(shape, 10, 10);
    list.push(shape);
    newItems.push({ layer, index: list.length - 1 });
  }
  if (!newItems.length) return false;
  setSelection(newItems);
  const c0 = getShapeByRef(newItems[0]);
  if (c0?.c != null) state.selectedColor = c0.c;
  renderAll();
  showToast(newItems.length > 1 ? `已粘贴 ${newItems.length} 个图元` : "已粘贴图元", "success");
  return true;
}

function drawShapePreview(ctx, type, color) {
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, 28, 20);
  const shape = defaultShapeAt(type, "mouth", 14, 10, color);
  const sh = shape.shape;
  if (shape.w != null) {
    shape.w = Math.min(shape.w, 20);
    shape.h = Math.min(shape.h, 14);
    shape.x = 14 - shape.w / 2;
    shape.y = 10 - shape.h / 2;
  }
  if (shape.r != null) shape.r = Math.min(shape.r, 7);
  if (shape.rw != null) {
    shape.rw = Math.min(shape.rw, 9);
    shape.rh = Math.min(shape.rh, 9);
  }
  if (sh === "line") {
    shape.x1 = 4;
    shape.y1 = 16;
    shape.x2 = 24;
    shape.y2 = 6;
  }
  if (sh === "hline") {
    shape.x = 4;
    shape.w = 20;
    shape.y = 10;
  }
  if (sh === "vline") {
    shape.x = 14;
    shape.y = 3;
    shape.h = 14;
  }
  drawShape(ctx, shape);
}

function renderShapePalette() {
  const box = els.shapePalette;
  if (!box) return;
  box.innerHTML = "";
  SHAPE_TYPES.forEach((t) => {
    const tile = document.createElement("div");
    tile.className = "shape-tile";
    tile.draggable = true;
    tile.dataset.shape = t.id;
    tile.title = t.hint ? `${t.label} — ${t.hint} · 拖到画布` : `${t.label} — 拖到画布`;

    const preview = document.createElement("canvas");
    preview.width = 28;
    preview.height = 20;
    preview.className = "shape-tile-preview";
    drawShapePreview(preview.getContext("2d"), t.id, state.selectedColor);

    const label = document.createElement("span");
    label.className = "shape-tile-label";
    label.textContent = t.label.replace(/\(.*\)/, "").trim();

    tile.appendChild(preview);
    tile.appendChild(label);
    tile.addEventListener("dragstart", (ev) => {
      ev.dataTransfer.setData(DRAG_MIME, t.id);
      ev.dataTransfer.setData("text/plain", t.id);
      ev.dataTransfer.effectAllowed = "copy";
      tile.classList.add("dragging");
    });
    tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
    tile.addEventListener("dblclick", () => {
      addShapeAt(t.id, state.canvas.w / 2, state.canvas.h / 2);
    });
    box.appendChild(tile);
  });
}

function renderColorPalette() {
  const box = els.colorPalette;
  if (!box) return;
  box.innerHTML = "";
  PALETTE_COLORS.forEach(({ c, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch" + (c === state.selectedColor ? " active" : "");
    btn.style.background = rgb565ToCss(c);
    btn.title = `${label} (${c})`;
    btn.onclick = () => setSelectedColor(c);
    box.appendChild(btn);
  });
}

function syncCanvasDisplaySize() {
  const canvas = els.canvas;
  if (!canvas) return;
  const displayW = state.canvas.w * CANVAS_DISPLAY_SCALE;
  const displayH = state.canvas.h * CANVAS_DISPLAY_SCALE;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  const root = document.documentElement;
  root.style.setProperty("--canvas-display-w", `${displayW}px`);
  if (els.frameTimeline) {
    els.frameTimeline.style.maxWidth = `${displayW}px`;
  }
}

function renderCanvas() {
  const canvas = els.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = state.canvas.w;
  canvas.height = state.canvas.h;
  drawFace(ctx, currentElements(), {
    width: state.canvas.w,
    height: state.canvas.h,
    showGrid: true,
    highlights: state.selection.items.filter((i) => isLayerEditable(i.layer)),
    lockedLayers: getLockedLayers(),
  });
  syncCanvasDisplaySize();
}

function renderPhonemeList() {
  const box = els.phonemeList;
  if (!box) return;
  box.innerHTML = "";
  state.phonemeExpressions.forEach((expr, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-item" + (idx === state.selectedPhonemeIdx ? " active" : "");
    btn.textContent = expressionListLabel(expr, idx);
    btn.onclick = () => {
      state.selectedPhonemeIdx = idx;
      state.selectedFrameIdx = 0;
      state.jsonEditorDirty = false;
      clearSelection();
      renderAll();
      startScenePlayback();
    };
    box.appendChild(btn);
  });
}

function renderSceneList() {
  const box = els.sceneList;
  if (!box) return;
  box.innerHTML = "";
  state.emotionExpressions.forEach((expr, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "list-item" + (idx === state.selectedEmotionIdx ? " active" : "");
    btn.textContent = expressionListLabel(expr, idx);
    btn.onclick = () => {
      state.selectedEmotionIdx = idx;
      state.selectedFrameIdx = 0;
      state.jsonEditorDirty = false;
      clearSelection();
      renderAll();
      startScenePlayback();
    };
    box.appendChild(btn);
  });
}

function renderProps() {
  const box = els.props;
  if (!box) return;
  const selCount = state.selection.items.length;
  if ((state.tab === "phoneme" || state.tab === "scene") && !selCount) {
    box.innerHTML = `<p class="muted">从右侧<strong>拖图元</strong>到画布，或双击图元库快速添加<br><small>框选 · 切换图层可编辑眼/鼻/嘴等 · 其余图层显示遮光罩</small></p>`;
    return;
  }
  if (selCount > 1) {
    box.innerHTML = `<div class="prop-head">${selCount} 个图元已选中</div>
      <p class="muted">拖动整体平移 · 方向键 1px · Shift+方向键 10px<br><kbd>Ctrl</kbd>+C/V · <kbd>Del</kbd> 删除 · <kbd>Ctrl</kbd>+Z 撤销</p>
      <div class="prop-actions">
        <button type="button" class="btn sm" id="prop-copy">复制</button>
        <button type="button" class="btn sm" id="prop-paste">粘贴</button>
        <button type="button" class="btn danger sm" id="prop-delete">删除</button>
      </div>`;
    $("prop-copy").onclick = () => copySelectedShape();
    $("prop-paste").onclick = () => pasteShape();
    $("prop-delete").onclick = () => deleteSelectedShape();
    return;
  }
  const ref = getSelectedShapeRef();
  if (!ref) {
    box.innerHTML = `<p class="muted">框选或点击图元 · 空白处拖出选框<br><small><kbd>Ctrl</kbd>+C/V · <kbd>Del</kbd> · 方向键平移 · <kbd>Ctrl</kbd>+Z 撤销</small></p>`;
    return;
  }
  const shape = ref.list[ref.index];
  const keys = Object.keys(shape).filter((k) => k !== "shape" && k !== "c");
  let html = `<div class="prop-head">${LAYER_LABELS[ref.layer] || ref.layer} · ${shape.shape}</div>`;
  html += `<div class="prop-color"><span>颜色</span><i class="prop-color-dot" style="background:${rgb565ToCss(shape.c ?? 65535)}"></i><span class="mono muted">${shape.c ?? 65535}</span></div>`;
  html += `<label class="prop-row"><span class="prop-label">类型</span><select id="prop-shape">${SHAPE_TYPES.map((t) => `<option value="${t.id}" ${t.id === shape.shape ? "selected" : ""}>${t.label}</option>`).join("")}</select></label>`;
  for (const k of keys) {
    const step = k === "angle" ? 45 : 1;
    html += `<label class="prop-row"><span class="prop-label">${k}</span><input data-key="${k}" type="number" value="${shape[k]}" step="${step}"></label>`;
  }
  html += `<div class="prop-actions">
    <button type="button" class="btn sm" id="prop-copy">复制</button>
    <button type="button" class="btn sm" id="prop-paste">粘贴</button>
    <button type="button" class="btn danger sm" id="prop-delete">删除</button>
  </div>`;
  box.innerHTML = html;
  $("prop-shape").onchange = (e) => {
    shape.shape = e.target.value;
    normalizeShapeAngle(shape);
    state.jsonEditorDirty = false;
    renderAll();
  };
  box.querySelectorAll("input[data-key]").forEach((inp) => {
    inp.oninput = () => {
      const key = inp.dataset.key;
      let val = Number(inp.value);
      if (key === "angle") {
        val = snapRotationAngle(val);
        inp.value = val;
      }
      shape[key] = val;
      renderCanvas();
      if (!state.jsonEditorDirty) renderJsonEditor();
    };
  });
  $("prop-copy").onclick = () => copySelectedShape();
  $("prop-paste").onclick = () => pasteShape();
  $("prop-delete").onclick = () => deleteSelectedShape();
}

function renderExpressionMeta() {
  const expr = getCurrentExpression();
  if (!expr) return;
  if (state.tab === "phoneme" && els.pName) {
    els.pName.value = expr.name || "";
    els.pTitle.value = expr.title || "";
    els.pAlias.value = (expr.alias || []).join(", ");
  }
  if (state.tab === "scene" && els.eName) {
    els.eName.value = expr.name || "";
    els.eTitle.value = expr.title || "";
    els.eAlias.value = (expr.alias || []).join(", ");
  }
}

function updateJsonModeButtons() {
  document.querySelectorAll(".json-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === state.jsonEditorMode);
  });
}

function updateJsonViewVisibility() {
  const isTree = state.jsonEditorMode === "json";
  els.jsonTree?.classList.toggle("hidden", !isTree);
  els.jsonEditor?.classList.toggle("hidden", isTree);
}

function renderJsonEditor() {
  const expr = getCurrentExpression();
  if (!expr) {
    if (els.jsonTree) els.jsonTree.innerHTML = "";
    if (els.jsonEditor) els.jsonEditor.value = "";
    return;
  }
  if (!state.jsonEditorDirty) {
    els.jsonEditor.value = formatExpressionJson(expr, 2);
    if (state.jsonEditorMode === "json") {
      renderJsonTree(els.jsonTree, expr);
    }
  } else if (state.jsonEditorMode === "json") {
    try {
      renderJsonTree(els.jsonTree, JSON.parse(els.jsonEditor.value));
    } catch {
      renderJsonTree(els.jsonTree, expr);
    }
  }
  updateJsonViewVisibility();
  updateJsonModeButtons();
}

function saveJsonEditor() {
  try {
    pushUndo();
    if (!applyExpressionMetaFromForm()) return;

    const expr = state.jsonEditorDirty
      ? normalizeExpression(JSON.parse(els.jsonEditor.value))
      : normalizeExpression(getCurrentExpression());
    const list = getCurrentExpressionList();
    const idx = state.tab === "phoneme" ? state.selectedPhonemeIdx : state.selectedEmotionIdx;
    const prev = structuredClone(list[idx]);
    list[idx] = expr;
    const dups = checkCurrentListConflicts(false);
    if (dups.length) {
      list[idx] = prev;
      showToast(formatExpressionConflictError(dups, list), "error");
      return;
    }
    state.jsonEditorDirty = false;
    clampFrameIdx();
    autosaveProjectIfNeeded(true);
    renderAll();
    showToast("已保存 JSON", "success");
  } catch (e) {
    showToast(`JSON 无效: ${e.message || e}`, "error");
  }
}

function formatJsonEditor() {
  if (state.jsonEditorMode !== "text") {
    showToast("格式化仅作用于文本视图", "error");
    return;
  }
  try {
    const raw = JSON.parse(els.jsonEditor.value);
    els.jsonEditor.value = formatExpressionJson(raw, 2);
    state.jsonEditorDirty = true;
    showToast("已格式化（2 空格缩进）", "success");
  } catch (e) {
    showToast(`无法格式化: ${e.message || e}`, "error");
  }
}

function switchJsonEditorMode(mode) {
  if (mode === state.jsonEditorMode) return;
  if (state.jsonEditorDirty) {
    showToast("请先保存文本后再切换视图", "error");
    return;
  }
  state.jsonEditorMode = mode;
  renderJsonEditor();
}

function syncStageVisibility() {
  const isSource = state.tab === "source";
  els.stageEdit?.classList.toggle("hidden", isSource);
  els.stageSource?.classList.toggle("hidden", !isSource);
  els.jsonEditorSection?.classList.toggle("hidden", isSource);
  if (els.stage) els.stage.classList.toggle("stage-source-mode", isSource);
}

function renderSourceEditor() {
  if (!els.sourceEditor) return;
  if (!state.sourceEditorDirty) {
    els.sourceEditor.value = getSourceDocText();
  }
  sourceEditorUi?.updateLineNumbers();
  sourceEditorUi?.syncGutterScroll();
}

async function copySourceEditor() {
  const text = els.sourceEditor?.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制到剪贴板", "success");
  } catch {
    showToast("复制失败", "error");
  }
}

function formatSourceEditor() {
  try {
    const raw = JSON.parse(els.sourceEditor.value);
    els.sourceEditor.value = JSON.stringify(raw, null, 2);
    state.sourceEditorDirty = true;
    sourceEditorUi?.updateLineNumbers();
    showToast("已格式化（2 空格缩进）", "success");
  } catch (e) {
    showToast(`无法格式化: ${e.message || e}`, "error");
  }
}

function saveSourceEditor() {
  if (state.readOnly) {
    showToast("内置模板只读，请另存为后再保存", "error");
    return;
  }
  try {
    pushUndo();
    applySourceDocToState(JSON.parse(els.sourceEditor.value));
    renderAll();
    if (state.projectId && state.projectName) {
      autosaveProjectIfNeeded(false);
      showToast("已保存并同步到音素/情绪表情", "success");
    } else {
      openProjectNameDialog("save");
    }
  } catch (e) {
    showToast(`JSON 无效: ${e.message || e}`, "error");
  }
}

function renderAll() {
  pruneSelection();
  syncDocMetaForm();
  syncDesignUi();
  syncStageVisibility();
  renderPhonemeList();
  renderSceneList();
  if (state.tab === "source") {
    renderSourceEditor();
  } else {
    syncLayerUi();
    renderCanvas();
    renderFrameTimeline();
    renderShapePalette();
    renderColorPalette();
    renderProps();
    renderExpressionMeta();
    renderJsonEditor();
    refreshPlayPreview();
  }
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === state.tab);
  });
  document.querySelectorAll(".panel-tab").forEach((p) => {
    p.classList.toggle("hidden", p.dataset.panel !== state.tab);
  });
  if (els.canvasMeta) {
    els.canvasMeta.textContent = `${state.canvas.w} × ${state.canvas.h}`;
  }
  agentPanel?.refresh();
  scheduleAutosave();
  updateUndoRedoButtons();
}

function canvasPoint(ev) {
  const canvas = els.canvas;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy,
  };
}

function updateMarqueeOverlay() {
  const m = state.marquee;
  const box = els.marqueeBox;
  const canvas = els.canvas;
  if (!m || !box || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width / canvas.width;
  const sy = rect.height / canvas.height;
  const x = Math.min(m.x0, m.x1) * sx;
  const y = Math.min(m.y0, m.y1) * sy;
  const w = Math.abs(m.x1 - m.x0) * sx;
  const h = Math.abs(m.y1 - m.y0) * sy;
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  box.classList.remove("hidden");
}

function hideMarqueeOverlay() {
  els.marqueeBox?.classList.add("hidden");
}

function bindCanvas() {
  const canvas = els.canvas;
  const wrap = els.canvasWrap;

  canvas.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    const p = canvasPoint(ev);

    const selRef = getPrimarySelectionRef();
    if (selRef) {
      const shape = selRef.list[selRef.index];
      const handle = hitTestHandle(shape, p.x, p.y);
      if (handle) {
        pushUndo();
        state.drag = { mode: "handle", handle: handle.id, ref: selRef, lastX: p.x, lastY: p.y };
        canvas.style.cursor = handle.cursor || "default";
        return;
      }
    }

    const hitOpts = { layers: getEditableLayers() };
    const hit = hitTest(currentElements(), p.x, p.y, hitOpts);
    if (hit) {
      if (!isShapeSelected(hit.layer, hit.index)) {
        setSelection([{ layer: hit.layer, index: hit.index }]);
      }
      pushUndo();
      state.drag = {
        mode: "move",
        lastX: p.x,
        lastY: p.y,
        items: [...state.selection.items],
      };
      const shape = hit.shape;
      if (shape?.c != null) {
        shape.c = quantizeColor256(shape.c);
        state.selectedColor = shape.c;
        renderColorPalette();
        if (els.colorCustomInput) els.colorCustomInput.value = rgb565ToHex(shape.c);
        if (els.colorCustomLabel) els.colorCustomLabel.textContent = `${rgb565ToHex(shape.c)} · ${shape.c}`;
      }
      renderAll();
      return;
    }

    state.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    state.drag = { mode: "marquee", lastX: p.x, lastY: p.y };
    updateMarqueeOverlay();
  });

  window.addEventListener("mousemove", (ev) => {
    if (state.gapDrag) {
      const sc = getCurrentScene();
      const fr = sc?.frames?.[state.gapDrag.frameIdx];
      if (fr) {
        const dx = ev.clientX - state.gapDrag.startX;
        fr.ms = Math.max(MIN_FRAME_MS, Math.round(state.gapDrag.startMs + dx * MS_PER_PX));
        renderFrameTimeline();
        if (state.gapDrag.frameIdx === state.selectedFrameIdx && els.frameMs) {
          els.frameMs.value = fr.ms;
        }
      }
      return;
    }
    if (!state.drag) return;
    const p = canvasPoint(ev);

    if (state.drag.mode === "marquee") {
      state.marquee.x1 = p.x;
      state.marquee.y1 = p.y;
      updateMarqueeOverlay();
      return;
    }

    const dx = p.x - state.drag.lastX;
    const dy = p.y - state.drag.lastY;

    if (state.drag.mode === "handle" && state.drag.ref) {
      const shape = state.drag.ref.list[state.drag.ref.index];
      dragShapeHandle(shape, state.drag.handle, dx, dy, p);
    } else if (state.drag.mode === "move" && state.drag.items?.length) {
      for (const item of state.drag.items) {
        const shape = getShapeByRef(item);
        if (shape) moveShape(shape, dx, dy);
      }
    } else {
      return;
    }

    state.drag.lastX = p.x;
    state.drag.lastY = p.y;
    renderCanvas();
    renderProps();
  });

  window.addEventListener("mouseup", () => {
    if (state.gapDrag) state.gapDrag = null;
    if (state.drag?.mode === "handle") canvas.style.cursor = "";

    if (state.drag?.mode === "marquee" && state.marquee) {
      const dist = Math.hypot(state.marquee.x1 - state.marquee.x0, state.marquee.y1 - state.marquee.y0);
      if (dist < 4) {
        clearSelection();
      } else {
        setSelection(findShapesInRect(state.marquee));
      }
      state.marquee = null;
      hideMarqueeOverlay();
      renderAll();
    } else if (state.drag && (state.tab === "scene" || state.tab === "phoneme")) {
      state.jsonEditorDirty = false;
      renderFrameTimeline();
      renderJsonEditor();
    }

    state.drag = null;
  });

  canvas.addEventListener(
    "wheel",
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const ref = getPrimarySelectionRef();
      if (!ref) return;
      pushUndo();
      const shape = ref.list[ref.index];
      const factor = ev.deltaY < 0 ? 1.08 : 0.92;
      const p = canvasPoint(ev);
      scaleShape(shape, factor, { x: p.x, y: p.y });
      renderAll();
    },
    { passive: false },
  );

  const onDragOver = (ev) => {
    const types = [...(ev.dataTransfer?.types || [])];
    if (!types.includes(DRAG_MIME) && !types.includes("text/plain")) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    wrap?.classList.add("drag-over");
  };
  const onDragLeave = (ev) => {
    if (wrap && !wrap.contains(ev.relatedTarget)) {
      wrap.classList.remove("drag-over");
    }
  };
  const onDrop = (ev) => {
    const type = ev.dataTransfer?.getData(DRAG_MIME) || ev.dataTransfer?.getData("text/plain");
    if (!type || !SHAPE_TYPES.some((t) => t.id === type)) return;
    ev.preventDefault();
    ev.stopPropagation();
    wrap?.classList.remove("drag-over");
    const p = canvasPoint(ev);
    addShapeAt(type, p.x, p.y);
  };

  canvas.addEventListener("dragover", onDragOver);
  canvas.addEventListener("dragleave", onDragLeave);
  canvas.addEventListener("drop", onDrop);
  if (wrap) {
    wrap.addEventListener("dragover", onDragOver);
    wrap.addEventListener("dragleave", onDragLeave);
  }
}

function bindKeyboard() {
  window.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key === "z" && !ev.shiftKey) {
      if (ev.target.matches("input, textarea, select")) return;
      ev.preventDefault();
      undoEdit();
      return;
    }
    if (mod && (ev.key === "y" || (ev.key === "z" && ev.shiftKey) || (ev.key === "Z" && ev.shiftKey))) {
      if (ev.target.matches("input, textarea, select")) return;
      ev.preventDefault();
      redoEdit();
      return;
    }

    if (ev.target.matches("input, textarea, select")) return;

    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (state.selection.items.length) {
        ev.preventDefault();
        deleteSelectedShapes();
      }
      return;
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.key)) {
      if (!state.selection.items.length) return;
      ev.preventDefault();
      const step = ev.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (ev.key === "ArrowLeft") dx = -step;
      if (ev.key === "ArrowRight") dx = step;
      if (ev.key === "ArrowUp") dy = -step;
      if (ev.key === "ArrowDown") dy = step;
      moveSelectedShapes(dx, dy);
      return;
    }

    if (ev.ctrlKey && ev.key === "c") {
      if (state.selection.items.length) {
        ev.preventDefault();
        copySelectedShapes();
      }
      return;
    }
    if (ev.ctrlKey && ev.key === "v") {
      ev.preventDefault();
      pasteShape();
    }
  });
}

function bindUi() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => {
      const nextTab = btn.dataset.tab;
      if (nextTab === state.tab) return;
      if (state.tab === "source" && !applySourceEditorIfDirty()) return;
      stopScenePlayback();
      state.tab = nextTab;
      state.jsonEditorDirty = false;
      clearSelection();
      renderAll();
    };
  });

  els.canvasW.onchange = () => {
    pushUndo();
    state.canvas.w = Math.max(64, Number(els.canvasW.value) || 284);
    syncCanvasDisplaySize();
    renderAll();
  };
  els.canvasH.onchange = () => {
    pushUndo();
    state.canvas.h = Math.max(64, Number(els.canvasH.value) || 240);
    syncCanvasDisplaySize();
    renderAll();
  };

  els.layerSelect.onchange = () => {
    state.editLayer = els.layerSelect.value;
    clearSelection();
    renderAll();
  };

  $("btn-add-frame")?.addEventListener("click", () => addSceneFrame());
  $("btn-del-frame")?.addEventListener("click", () => deleteSceneFrame());
  $("btn-play-scene")?.addEventListener("click", () => startScenePlayback());
  $("btn-stop-play")?.addEventListener("click", () => stopScenePlayback());
  els.frameMs?.addEventListener("change", () => {
    const sc = getCurrentScene();
    const fr = sc?.frames?.[state.selectedFrameIdx];
    if (!fr) return;
    pushUndo();
    fr.ms = Math.max(MIN_FRAME_MS, Number(els.frameMs.value) || 800);
    state.jsonEditorDirty = false;
    renderFrameTimeline();
    renderJsonEditor();
  });

  if (els.colorCustomInput) {
    els.colorCustomInput.oninput = () => {
      setSelectedColor(hexToRgb565(els.colorCustomInput.value));
    };
  }

  $("btn-add-phoneme").onclick = () => {
    pushUndo();
    state.phonemeExpressions.push(defaultPhonemeExpression("a"));
    state.selectedPhonemeIdx = state.phonemeExpressions.length - 1;
    state.jsonEditorDirty = false;
    renderAll();
  };

  $("btn-del-phoneme").onclick = () => {
    if (!state.phonemeExpressions.length) return;
    pushUndo();
    state.phonemeExpressions.splice(state.selectedPhonemeIdx, 1);
    state.selectedPhonemeIdx = Math.max(0, state.selectedPhonemeIdx - 1);
    state.jsonEditorDirty = false;
    checkExpressionConflicts(state.phonemeExpressions, true);
    renderAll();
  };

  const bindMetaField = (el, onApply) => {
    if (!el) return;
    el.onchange = () => {
      pushUndo();
      if (onApply()) renderAll();
    };
  };
  bindMetaField(els.pName, () => applyExpressionMetaFromForm());
  bindMetaField(els.pTitle, () => applyExpressionMetaFromForm());
  bindMetaField(els.pAlias, () => applyExpressionMetaFromForm());
  bindMetaField(els.eName, () => applyExpressionMetaFromForm());
  bindMetaField(els.eTitle, () => applyExpressionMetaFromForm());
  bindMetaField(els.eAlias, () => applyExpressionMetaFromForm());

  $("btn-add-scene").onclick = () => {
    const name = `expr_${Date.now().toString(36).slice(-6)}`;
    pushUndo();
    state.emotionExpressions.push(defaultExpression(name, "新表情", []));
    state.selectedEmotionIdx = state.emotionExpressions.length - 1;
    state.jsonEditorDirty = false;
    renderAll();
  };

  $("btn-del-scene").onclick = () => {
    if (!state.emotionExpressions.length) return;
    pushUndo();
    state.emotionExpressions.splice(state.selectedEmotionIdx, 1);
    state.selectedEmotionIdx = Math.max(0, state.selectedEmotionIdx - 1);
    state.jsonEditorDirty = false;
    checkExpressionConflicts(state.emotionExpressions, true);
    renderAll();
  };

  $("btn-save-design")?.addEventListener("click", () => saveCurrentProject());
  $("btn-save-as")?.addEventListener("click", () => openSaveAsDialog());
  $("btn-export-project")?.addEventListener("click", () => exportCurrentProjectZip());
  $("btn-export-design")?.addEventListener("click", () => exportCurrentDesignJson());

  bindMetaField(els.docName, () => {
    applyDocMetaFromForm();
    autosaveProjectIfNeeded(true);
    syncDesignUi();
  });
  bindMetaField(els.docDescription, () => {
    applyDocMetaFromForm();
    autosaveProjectIfNeeded(true);
  });
  $("btn-open-picker")?.addEventListener("click", () => projectPicker?.show());

  $("btn-undo")?.addEventListener("click", () => undoEdit());
  $("btn-redo")?.addEventListener("click", () => redoEdit());

  if (els.props) {
    let propsUndoPushed = false;
    els.props.addEventListener("focusin", (ev) => {
      if (state.readOnly) return;
      if (ev.target.matches("input, select") && !propsUndoPushed) {
        pushUndo();
        propsUndoPushed = true;
      }
    });
    els.props.addEventListener("focusout", (ev) => {
      if (!els.props.contains(ev.relatedTarget)) {
        propsUndoPushed = false;
      }
    });
  }

  document.querySelectorAll(".json-mode-btn").forEach((btn) => {
    btn.onclick = () => switchJsonEditorMode(btn.dataset.mode);
  });
  $("btn-format-json")?.addEventListener("click", () => formatJsonEditor());
  els.jsonEditor?.addEventListener("input", () => {
    state.jsonEditorDirty = true;
  });

  $("btn-copy-source")?.addEventListener("click", () => copySourceEditor());
  $("btn-format-source")?.addEventListener("click", () => formatSourceEditor());
  $("btn-save-source")?.addEventListener("click", () => saveSourceEditor());
  $("btn-export-source")?.addEventListener("click", () => exportSourceFile());
  $("btn-import-source")?.addEventListener("click", () => els.importSource?.click());
  els.importSource?.addEventListener("change", async () => {
    const f = els.importSource.files?.[0];
    if (!f) return;
    try {
      await importSourceFile(f);
    } catch (e) {
      setStatus(String(e.message || e), true);
      showToast(String(e.message || e), "error");
    }
    els.importSource.value = "";
  });
  els.sourceEditor?.addEventListener("input", () => {
    state.sourceEditorDirty = true;
    sourceEditorUi?.updateLineNumbers();
  });
}

async function boot() {
  els.canvas = $("face-canvas");
  els.canvasWrap = $("canvas-wrap");
  els.marqueeBox = $("marquee-box");
  els.frameTimeline = $("frame-timeline");
  els.frameTrack = $("frame-track");
  els.frameMs = $("frame-ms");
  els.frameTotalMs = $("frame-total-ms");
  els.btnDelFrame = $("btn-del-frame");
  els.playPreview = $("play-preview");
  els.playCanvas = $("play-canvas");
  els.playTimeLabel = $("play-time-label");
  els.btnStopPlay = $("btn-stop-play");
  els.phonemeList = $("phoneme-list");
  els.sceneList = $("scene-list");
  els.shapePalette = $("shape-palette");
  els.colorPalette = $("color-palette");
  els.colorCustomInput = $("color-custom-input");
  els.colorCustomLabel = $("color-custom-label");
  els.props = $("props-panel");
  els.status = $("status-bar");
  els.canvasMeta = $("canvas-meta");
  els.canvasW = $("canvas-w");
  els.canvasH = $("canvas-h");
  els.layerSelect = $("layer-select");
  els.layerLockHint = $("layer-lock-hint");
  els.phonemeMeta = $("phoneme-meta");
  els.pName = $("p-name");
  els.pTitle = $("p-title");
  els.pAlias = $("p-alias");
  els.eName = $("e-name");
  els.eTitle = $("e-title");
  els.eAlias = $("e-alias");
  els.jsonTree = $("json-tree");
  els.jsonEditor = $("json-editor");
  els.jsonEditorSection = document.querySelector(".json-editor-section");
  els.stageEdit = $("stage-edit");
  els.stageSource = $("stage-source");
  els.sourceEditor = $("source-editor");
  els.sourceLineGutter = $("source-line-gutter");
  els.sourceLineNumbers = $("source-line-numbers");
  els.sourceFindBar = $("source-find-bar");
  els.sourceFindInput = $("source-find-input");
  els.sourceFindStatus = $("source-find-status");
  els.stage = document.querySelector(".stage");
  els.importSource = $("import-source");
  els.docName = $("doc-name");
  els.docDescription = $("doc-description");
  els.docFileLabel = $("doc-file-label");
  els.docReadonlyBadge = $("doc-readonly-badge");
  els.btnSaveDesign = $("btn-save-design");
  els.btnUndo = $("btn-undo");
  els.btnRedo = $("btn-redo");

  els.canvasW.value = state.canvas.w;
  els.canvasH.value = state.canvas.h;

  await loadInitialSource();

  checkExpressionConflicts(state.phonemeExpressions, true);
  checkExpressionConflicts(state.emotionExpressions, true);

  bindCanvas();
  bindKeyboard();
  bindUi();
  sourceEditorUi = initSourceEditor({
    textarea: els.sourceEditor,
    lineGutter: els.sourceLineGutter,
    lineNumbers: els.sourceLineNumbers,
    findBar: els.sourceFindBar,
    findInput: els.sourceFindInput,
    findStatus: els.sourceFindStatus,
    findPrev: $("source-find-prev"),
    findNext: $("source-find-next"),
    findClose: $("source-find-close"),
    isActive: () => state.tab === "source",
  });
  agentPanel = initAgentPanel({
    getAgentContext,
    applySourceDoc: (doc) => applyAgentSource(doc),
    onAgentStateChange: () => scheduleAutosave(),
  });
  projectPicker = createProjectPicker({
    onOpenProject(project) {
      openProjectRecord(project);
    },
    onSelectCatalog(doc, item) {
      beginCatalogProject(doc, item);
    },
    onNewProject() {
      openProjectNameDialog("new");
    },
    onImportJson(doc, base) {
      importJsonAsProject(doc, base);
    },
    onImportZip(payload) {
      importZipAsProject(payload);
    },
    onDeleteProject(id) {
      handleDeleteProject(id);
    },
    onDraftsCleaned(count) {
      showToast(`已删除 ${count} 个 draft 草稿项目`, "success");
      setStatus(`已清理 ${count} 个 draft 草稿项目`);
    },
    onError(e) {
      setStatus(String(e.message || e), true);
      showToast(String(e.message || e), "error");
    },
  });
  projectNameDialog = createProjectNameDialog({
    onConfirm: (projectName) => handleProjectNameConfirm(projectName),
    onError(e) {
      showToast(String(e.message || e), "error");
    },
  });
  await projectPicker.show();
}

boot();

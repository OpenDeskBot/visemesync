/** 启动时项目选择：从 data/projects.json 载入或新建 */

import {
  defaultSourceDoc,
  loadProjectCatalog,
  loadProjectFile,
  validateSourceDoc,
} from "./data-models.js";

export function createProjectPicker({ onOpen, onError }) {
  const overlay = document.getElementById("project-picker");
  const listEl = document.getElementById("project-list");
  const draftRow = document.getElementById("project-draft-row");
  const btnDraft = document.getElementById("btn-load-draft");
  const btnNew = document.getElementById("btn-new-project");
  const btnImport = document.getElementById("btn-import-project");
  const importInput = document.getElementById("import-project-file");

  if (!overlay || !listEl) return { show: async () => {}, hide: () => {} };

  function hide() {
    overlay.classList.add("hidden");
    document.body.classList.remove("project-picker-open");
  }

  function show() {
    overlay.classList.remove("hidden");
    document.body.classList.add("project-picker-open");
  }

  function renderCatalog(catalog) {
    listEl.innerHTML = "";
    if (!catalog.length) {
      const empty = document.createElement("p");
      empty.className = "project-empty muted";
      empty.textContent = "data/projects.json 中暂无预设项目";
      listEl.appendChild(empty);
      return;
    }
    catalog.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "project-card";
      card.innerHTML = `
        <span class="project-card-name">${escapeHtml(item.name)}</span>
        <span class="project-card-desc">${escapeHtml(item.description || "无说明")}</span>
        <span class="project-card-file mono muted">${escapeHtml(item.file)}</span>`;
      card.addEventListener("click", async () => {
        try {
          const doc = validateSourceDoc(await loadProjectFile(item.file));
          onOpen(doc, { file: item.file, from: "catalog" });
          hide();
        } catch (e) {
          onError?.(e);
        }
      });
      listEl.appendChild(card);
    });
  }

  btnNew?.addEventListener("click", () => {
    onOpen(defaultSourceDoc(), { file: null, from: "new" });
    hide();
  });

  btnImport?.addEventListener("click", () => importInput?.click());

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const doc = validateSourceDoc(JSON.parse(text));
      onOpen(doc, { file: file.name, from: "import" });
      hide();
    } catch (e) {
      onError?.(e);
    }
    importInput.value = "";
  });

  btnDraft?.addEventListener("click", () => {
    try {
      const raw = localStorage.getItem("visemesync.source");
      if (!raw) throw new Error("无本地草稿");
      const doc = validateSourceDoc(JSON.parse(raw));
      onOpen(doc, { file: null, from: "draft" });
      hide();
    } catch (e) {
      onError?.(e);
    }
  });

  return {
    async show() {
      const hasDraft = !!localStorage.getItem("visemesync.source");
      if (draftRow) draftRow.classList.toggle("hidden", !hasDraft);
      listEl.innerHTML = '<p class="project-loading muted">加载项目列表…</p>';
      show();
      try {
        const catalog = await loadProjectCatalog();
        renderCatalog(catalog);
      } catch (e) {
        listEl.innerHTML = `<p class="project-empty err">${escapeHtml(String(e.message || e))}</p>`;
      }
    },
    hide,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

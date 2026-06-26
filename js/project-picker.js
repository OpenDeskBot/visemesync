/** 项目选择：内置模板 + localStorage 项目 */

import {
  defaultSourceDoc,
  loadProjectCatalog,
  loadProjectFile,
  validateSourceDoc,
} from "./data-models.js";
import {
  listProjects,
  loadProject,
  deleteProject,
  deleteAllDraftProjects,
  formatUpdatedAt,
  defaultAgentChats,
} from "./project-store.js";
import { importProjectZip } from "./project-export.js";

export function createProjectPicker({
  onOpenProject,
  onSelectCatalog,
  onNewProject,
  onImportJson,
  onImportZip,
  onDeleteProject,
  onDraftsCleaned,
  onError,
}) {
  const overlay = document.getElementById("project-picker");
  const catalogListEl = document.getElementById("catalog-list");
  const localListEl = document.getElementById("local-design-list");
  const btnNew = document.getElementById("btn-new-project");
  const btnImport = document.getElementById("btn-import-project");
  const btnImportZip = document.getElementById("btn-import-project-zip");
  const btnCleanupDrafts = document.getElementById("btn-cleanup-drafts");
  const importInput = document.getElementById("import-project-file");
  const importZipInput = document.getElementById("import-project-zip");

  if (!overlay || !catalogListEl || !localListEl) {
    return { show: async () => {}, hide: () => {} };
  }

  function hide() {
    overlay.classList.add("hidden");
    document.body.classList.remove("project-picker-open");
  }

  function showOverlay() {
    overlay.classList.remove("hidden");
    document.body.classList.add("project-picker-open");
  }

  function renderCard(item, { badge, onClick }) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "project-card";
    const badgeHtml = badge ? `<span class="project-card-badge">${escapeHtml(badge)}</span>` : "";
    card.innerHTML = `
      <span class="project-card-top">
        <span class="project-card-name">${escapeHtml(item.name)}</span>
        ${badgeHtml}
      </span>
      <span class="project-card-desc">${escapeHtml(item.description || "无说明")}</span>
      <span class="project-card-file mono muted">${escapeHtml(item.file || item.projectName || "")}</span>`;
    card.addEventListener("click", onClick);
    return card;
  }

  function renderCatalog(catalog) {
    catalogListEl.innerHTML = "";
    if (!catalog.length) {
      catalogListEl.innerHTML = '<p class="project-empty muted">暂无内置模板</p>';
      return;
    }
    catalog.forEach((item) => {
      catalogListEl.appendChild(
        renderCard(item, {
          badge: "模板",
          onClick: async () => {
            try {
              const doc = validateSourceDoc(await loadProjectFile(item.file));
              hide();
              onSelectCatalog?.(doc, item);
            } catch (e) {
              onError?.(e);
            }
          },
        }),
      );
    });
  }

  function renderLocalProjects() {
    localListEl.innerHTML = "";
    const projects = listProjects();
    if (!projects.length) {
      localListEl.innerHTML = '<p class="project-empty muted">暂无本地项目，请新建或从模板创建</p>';
      return;
    }
    projects.forEach((item) => {
      const row = document.createElement("div");
      row.className = "project-card-row";

      const card = renderCard(
        {
          name: item.projectName,
          description: item.description,
          projectName: item.projectName,
        },
        {
          badge: formatUpdatedAt(item.updatedAt) || null,
          onClick: () => {
            try {
              const project = loadProject(item.id);
              onOpenProject?.(project);
              hide();
            } catch (e) {
              onError?.(e);
            }
          },
        },
      );

      const del = document.createElement("button");
      del.type = "button";
      del.className = "project-card-del";
      del.textContent = "×";
      del.title = "删除项目";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!confirm(`确定删除项目「${item.projectName}」？此操作不可恢复。`)) return;
        try {
          deleteProject(item.id);
          onDeleteProject?.(item.id);
          renderLocalProjects();
        } catch (e) {
          onError?.(e);
        }
      });

      row.appendChild(card);
      row.appendChild(del);
      localListEl.appendChild(row);
    });
  }

  btnNew?.addEventListener("click", () => {
    hide();
    onNewProject?.();
  });

  btnImport?.addEventListener("click", () => importInput?.click());
  btnImportZip?.addEventListener("click", () => importZipInput?.click());

  btnCleanupDrafts?.addEventListener("click", () => {
    const draftCount = listProjects().filter((p) => /^draft(-\d+)?$/i.test(p.projectName)).length;
    if (!draftCount) {
      onError?.(new Error("没有 draft 草稿项目"));
      return;
    }
    if (
      !confirm(
        `将删除 ${draftCount} 个 draft 草稿项目（旧版自动保存遗留，名称如 draft、draft-1…），不可恢复。确定？`,
      )
    ) {
      return;
    }
    try {
      const removed = deleteAllDraftProjects();
      onDraftsCleaned?.(removed);
      renderLocalProjects();
    } catch (e) {
      onError?.(e);
    }
  });

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const doc = validateSourceDoc(JSON.parse(text));
      const base = file.name.replace(/\.json$/i, "") || "project";
      hide();
      onImportJson?.(doc, base);
    } catch (e) {
      onError?.(e);
    }
    importInput.value = "";
  });

  importZipInput?.addEventListener("change", async () => {
    const file = importZipInput.files?.[0];
    if (!file) return;
    try {
      const payload = await importProjectZip(file);
      hide();
      onImportZip?.(payload);
    } catch (e) {
      onError?.(e);
    }
    importZipInput.value = "";
  });

  return {
    async show() {
      catalogListEl.innerHTML = '<p class="project-loading muted">加载内置模板…</p>';
      localListEl.innerHTML = '<p class="project-loading muted">加载本地项目…</p>';
      showOverlay();
      renderLocalProjects();
      try {
        const catalog = await loadProjectCatalog();
        renderCatalog(catalog);
      } catch (e) {
        catalogListEl.innerHTML = `<p class="project-empty err">${escapeHtml(String(e.message || e))}</p>`;
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

export { defaultSourceDoc, defaultAgentChats };

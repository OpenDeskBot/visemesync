/** 项目名称对话框（新建 / 另存为） */

import { normalizeProjectName } from "./project-store.js";

export function createProjectNameDialog({ onConfirm, onError }) {
  const overlay = document.getElementById("save-as-dialog");
  const titleEl = document.getElementById("save-as-title");
  const hintEl = document.getElementById("save-as-hint");
  const input = document.getElementById("save-as-filename");
  const btnCancel = document.getElementById("btn-save-as-cancel");
  const btnConfirm = document.getElementById("btn-save-as-confirm");

  if (!overlay || !input) {
    return { open: () => {} };
  }

  let confirmLabel = "保存";

  function hide() {
    overlay.classList.add("hidden");
    document.body.classList.remove("save-as-open");
  }

  function show(options = {}) {
    const {
      title = "另存为项目",
      hint = "输入项目名称（不含 .json），将保存到浏览器 localStorage",
      defaultName = "my-project",
      confirmText = "保存",
    } = options;
    if (titleEl) titleEl.textContent = title;
    if (hintEl) hintEl.textContent = hint;
    confirmLabel = confirmText;
    if (btnConfirm) btnConfirm.textContent = confirmText;
    input.value = defaultName.replace(/\.json$/i, "");
    overlay.classList.remove("hidden");
    document.body.classList.add("save-as-open");
    input.focus();
    input.select();
  }

  btnCancel?.addEventListener("click", hide);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) hide();
  });

  btnConfirm?.addEventListener("click", () => {
    try {
      const projectName = normalizeProjectName(input.value);
      onConfirm?.(projectName);
      hide();
    } catch (e) {
      onError?.(e);
    }
  });

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      btnConfirm?.click();
    }
    if (ev.key === "Escape") hide();
  });

  return { open: show, hide };
}

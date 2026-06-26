/** 轻量 Toast 通知（替代 alert/confirm） */

let container = null;

function getContainer() {
  if (!container) container = document.getElementById("toast-container");
  return container;
}

export function showToast(message, type = "error", duration = 3500) {
  const box = getContainer();
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 320);
  }, duration);
}

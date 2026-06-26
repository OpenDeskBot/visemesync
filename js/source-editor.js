/** 源码编辑器：行号 gutter + Ctrl+F 查找 */

export function initSourceEditor({
  textarea,
  lineGutter,
  lineNumbers,
  findBar,
  findInput,
  findStatus,
  findPrev,
  findNext,
  findClose,
  isActive,
}) {
  if (!textarea) return {};

  function updateLineNumbers() {
    if (!lineNumbers) return;
    const lines = textarea.value.split("\n").length || 1;
    lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  }

  function syncGutterScroll() {
    if (lineGutter) lineGutter.scrollTop = textarea.scrollTop;
  }

  function scrollToIndex(index) {
    const before = textarea.value.slice(0, index);
    const line = before.split("\n").length - 1;
    const style = getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || 17;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const target = line * lineHeight + paddingTop - textarea.clientHeight / 2;
    textarea.scrollTop = Math.max(0, target);
    syncGutterScroll();
  }

  function findMatches(query) {
    if (!query) return [];
    const text = textarea.value;
    const hits = [];
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(query, from);
      if (idx === -1) break;
      hits.push(idx);
      from = idx + (query.length || 1);
    }
    return hits;
  }

  function selectMatch(index, query) {
    textarea.focus();
    textarea.setSelectionRange(index, index + query.length);
    scrollToIndex(index);
  }

  function updateFindStatus(query, hitIdx, total) {
    if (!findStatus) return;
    if (!query) {
      findStatus.textContent = "";
      return;
    }
    if (!total) {
      findStatus.textContent = "未找到";
      return;
    }
    findStatus.textContent = `${hitIdx + 1} / ${total}`;
  }

  function runFind(forward = true) {
    const query = findInput?.value ?? "";
    if (!query) {
      updateFindStatus("");
      return;
    }
    const hits = findMatches(query);
    if (!hits.length) {
      updateFindStatus(query, 0, 0);
      return;
    }
    const start = forward
      ? Math.max(textarea.selectionEnd, textarea.selectionStart)
      : Math.min(textarea.selectionStart, textarea.selectionEnd) - 1;
    let hitIdx;
    if (forward) {
      hitIdx = hits.findIndex((i) => i >= start);
      if (hitIdx === -1) hitIdx = 0;
    } else {
      hitIdx = -1;
      for (let i = hits.length - 1; i >= 0; i -= 1) {
        if (hits[i] < start) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx === -1) hitIdx = hits.length - 1;
    }
    selectMatch(hits[hitIdx], query);
    updateFindStatus(query, hitIdx, hits.length);
  }

  function openFind() {
    if (!findBar) return;
    findBar.classList.remove("hidden");
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected && !selected.includes("\n") && findInput) {
      findInput.value = selected;
    }
    findInput?.focus();
    findInput?.select();
    runFind(true);
  }

  function closeFind() {
    findBar?.classList.add("hidden");
    if (findStatus) findStatus.textContent = "";
    textarea.focus();
  }

  textarea.addEventListener("input", updateLineNumbers);
  textarea.addEventListener("scroll", syncGutterScroll);

  findInput?.addEventListener("input", () => runFind(true));
  findInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      runFind(!ev.shiftKey);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeFind();
    }
  });
  findPrev?.addEventListener("click", () => runFind(false));
  findNext?.addEventListener("click", () => runFind(true));
  findClose?.addEventListener("click", closeFind);

  document.addEventListener("keydown", (ev) => {
    if (!isActive?.()) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      openFind();
    }
  });

  updateLineNumbers();

  return { updateLineNumbers, openFind, closeFind, syncGutterScroll };
}

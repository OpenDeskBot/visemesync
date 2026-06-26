/** 只读 JSON 树状展开视图 */

function isExpandable(value) {
  return value !== null && typeof value === "object";
}

function valuePreview(value) {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).length}}`;
  return JSON.stringify(value);
}

function buildNode(key, value, depth, autoExpandDepth) {
  const node = document.createElement("div");
  node.className = "json-tree-node";

  if (!isExpandable(value)) {
    const row = document.createElement("div");
    row.className = "json-tree-row json-tree-leaf";
    row.style.paddingLeft = `${depth * 14 + 4}px`;
    if (key !== "") {
      const keyEl = document.createElement("span");
      keyEl.className = "json-tree-key";
      keyEl.textContent = `${key}: `;
      row.appendChild(keyEl);
    }
    const valEl = document.createElement("span");
    valEl.className = "json-tree-value";
    valEl.textContent = valuePreview(value);
    row.appendChild(valEl);
    node.appendChild(row);
    return node;
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  let expanded = depth < autoExpandDepth;

  const row = document.createElement("div");
  row.className = "json-tree-row";
  row.style.paddingLeft = `${depth * 14 + 4}px`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "json-tree-toggle";
  toggle.textContent = expanded ? "▼" : "▶";
  toggle.setAttribute("aria-label", expanded ? "折叠" : "展开");

  const keyEl = document.createElement("span");
  keyEl.className = "json-tree-key";
  if (key !== "") keyEl.textContent = `${key}: `;

  const summary = document.createElement("span");
  summary.className = "json-tree-summary";
  summary.textContent = isArray ? `[${value.length}]` : `{${entries.length}}`;

  row.appendChild(toggle);
  row.appendChild(keyEl);
  row.appendChild(summary);
  node.appendChild(row);

  const children = document.createElement("div");
  children.className = "json-tree-children";
  children.hidden = !expanded;

  toggle.onclick = () => {
    expanded = !expanded;
    toggle.textContent = expanded ? "▼" : "▶";
    toggle.setAttribute("aria-label", expanded ? "折叠" : "展开");
    children.hidden = !expanded;
  };

  for (const [k, v] of entries) {
    children.appendChild(buildNode(k, v, depth + 1, autoExpandDepth));
  }
  node.appendChild(children);
  return node;
}

export function renderJsonTree(container, data, { autoExpandDepth = 2 } = {}) {
  if (!container) return;
  container.innerHTML = "";
  if (data == null) return;
  container.appendChild(buildNode("", data, 0, autoExpandDepth));
}

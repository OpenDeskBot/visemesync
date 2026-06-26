import { runAgentWithTools, loadAgentConfig, saveAgentConfig, DEFAULT_AGENT_CONFIG } from "./agent-api.js";
import { buildAgentSystemPrompt, sessionToApiMessages, apiMessagesToSession } from "./agent-prompt.js";
import { AGENT_TOOLS, createToolExecutor } from "./agent-tools.js";
import { showToast } from "./toast.js";
import { defaultAgentChats, chatUid } from "./project-store.js";

function uid() {
  return chatUid();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (!value) {
    showToast("无内容可复制", "error");
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast("已复制", "success");
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("已复制", "success");
      return true;
    } catch {
      showToast("复制失败", "error");
      return false;
    }
  }
}

function createCopyButton(getText) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "agent-msg-copy";
  btn.title = "复制";
  btn.setAttribute("aria-label", "复制");
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const text = typeof getText === "function" ? getText() : getText;
    copyToClipboard(text);
  });
  return btn;
}

function createMsgHead(label, copyText) {
  const head = document.createElement("div");
  head.className = "agent-msg-head";
  const title = document.createElement("span");
  title.className = "agent-msg-label";
  title.textContent = label;
  head.appendChild(title);
  if (copyText != null) {
    head.appendChild(createCopyButton(copyText));
  }
  return head;
}

function renderToolLine(container, m) {
  const row = document.createElement("div");
  const isErr = String(m.content).startsWith("ERROR:");
  row.className = "agent-tool-event" + (isErr ? " error" : "");
  const icon = m.toolName === "write" ? "✏️" : "📖";
  const path = m.path ? `(${m.path})` : "";
  row.textContent = `${icon} ${m.toolName || "tool"}${path} → ${String(m.content).split("\n")[0]}`;
  container.appendChild(row);
}

function renderAgentGroup(group) {
  const div = document.createElement("div");
  div.className = "agent-msg agent-msg-assistant";

  const texts = group.filter((m) => m.role === "assistant" && m.content).map((m) => m.content);
  const toolLines = group
    .filter((m) => m.role === "tool")
    .map((m) => {
      const icon = m.toolName === "write" ? "✏️" : "📖";
      const path = m.path ? `(${m.path})` : "";
      return `${icon} ${m.toolName || "tool"}${path} → ${String(m.content).split("\n")[0]}`;
    });
  const copyText = [...texts, ...toolLines].filter(Boolean).join("\n\n");

  div.appendChild(createMsgHead("Agent", copyText || null));

  if (texts.length) {
    const body = document.createElement("div");
    body.className = "agent-msg-body";
    body.innerHTML = `<pre>${escapeHtml(texts.join("\n\n"))}</pre>`;
    div.appendChild(body);
  }

  const toolsBox = document.createElement("div");
  toolsBox.className = "agent-tool-events";
  group.filter((m) => m.role === "tool").forEach((m) => renderToolLine(toolsBox, m));
  if (toolsBox.childElementCount) div.appendChild(toolsBox);

  return div;
}

export function initAgentPanel(hooks) {
  const panel = document.getElementById("agent-panel");
  if (!panel) return;

  const els = {
    toggle: panel.querySelector("#agent-panel-toggle"),
    body: panel.querySelector(".agent-panel-body"),
    resize: panel.querySelector(".agent-resize-handle"),
    apiKey: panel.querySelector("#agent-api-key"),
    baseUrl: panel.querySelector("#agent-base-url"),
    model: panel.querySelector("#agent-model"),
    temperature: panel.querySelector("#agent-temperature"),
    btnSaveConfig: panel.querySelector("#agent-save-config"),
    sessionList: panel.querySelector("#agent-session-list"),
    btnNewSession: panel.querySelector("#agent-new-session"),
    messages: panel.querySelector("#agent-messages"),
    input: panel.querySelector("#agent-input"),
    btnSend: panel.querySelector("#agent-send"),
    focusHint: panel.querySelector("#agent-focus-hint"),
  };

  let config = loadAgentConfig();
  let sessions = defaultAgentChats().agentChatList;
  let activeId = defaultAgentChats().currentAgentChat;
  let sending = false;
  let runningSessionId = null;
  let liveStream = null;
  let abortController = null;
  let collapsed = localStorage.getItem("visemesync.agent.collapsed") === "1";
  const executeTool = createToolExecutor(hooks);

  function updateRunningUi() {
    els.btnSend.disabled = sending;
    if (els.toggle) {
      els.toggle.textContent = collapsed ? "Agent" : "收起";
    }
  }

  function abortAgentRun() {
    if (!sending || !abortController) return;
    abortController.abort();
    showToast("正在中断…", "success");
  }

  function persistAgentState() {
    hooks.onAgentStateChange?.({
      agentChatList: sessions,
      currentAgentChat: activeId,
    });
  }

  function activeSession() {
    return sessions.find((s) => s.id === activeId) || sessions[0];
  }

  function fillConfigForm() {
    els.apiKey.value = config.apiKey || "";
    els.baseUrl.value = config.baseUrl || DEFAULT_AGENT_CONFIG.baseUrl;
    els.model.value = config.model || DEFAULT_AGENT_CONFIG.model;
    els.temperature.value = config.temperature ?? DEFAULT_AGENT_CONFIG.temperature;
  }

  function saveConfigFromForm(silent = false) {
    config = {
      ...config,
      apiKey: els.apiKey.value.trim(),
      baseUrl: els.baseUrl.value.trim(),
      model: els.model.value.trim(),
      temperature: Number(els.temperature.value) || 0.3,
    };
    saveAgentConfig(config);
    if (!silent) showToast("Agent 配置已保存", "success");
  }

  function scrollMessagesIfActive(sessionId) {
    if (sessionId === activeId) {
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  }

  function renderSessions() {
    els.sessionList.innerHTML = "";
    sessions.forEach((s) => {
      const isRunning = sending && s.id === runningSessionId;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "agent-session-item" +
        (s.id === activeId ? " active" : "") +
        (isRunning ? " running" : "");
      btn.textContent = s.title;
      btn.title = isRunning ? `${s.title}（运行中）` : s.title;
      btn.onclick = () => {
        if (s.id === activeId) return;
        activeId = s.id;
        persistAgentState();
        renderSessions();
        renderMessages();
      };
      const del = document.createElement("button");
      del.type = "button";
      del.className = "agent-session-del";
      del.textContent = "×";
      del.title = "删除对话";
      del.onclick = (ev) => {
        ev.stopPropagation();
        if (isRunning) {
          showToast("运行中的对话无法删除，请先中断", "error");
          return;
        }
        if (sessions.length <= 1) {
          showToast("至少保留一个对话", "error");
          return;
        }
        sessions = sessions.filter((x) => x.id !== s.id);
        if (activeId === s.id) activeId = sessions[0].id;
        persistAgentState();
        renderSessions();
        renderMessages();
      };
      const row = document.createElement("div");
      row.className = "agent-session-row";
      row.appendChild(btn);
      row.appendChild(del);
      els.sessionList.appendChild(row);
    });
  }

  function renderMessages() {
    const session = activeSession();
    if (!session) return;

    if (liveStream?.div?.parentNode === els.messages) {
      liveStream.div.remove();
    }

    els.messages.innerHTML = "";
    if (!session.messages.length && !(sending && session.id === runningSessionId)) {
      els.messages.innerHTML = `<p class="muted agent-empty">描述想要的表情变化。Agent 会通过 <code>read</code> 读取源代码、<code>write</code> 写回编辑器。切换 Tab 会改变编辑焦点。</p>`;
    } else {
      let i = 0;
      while (i < session.messages.length) {
        const m = session.messages[i];
        if (m.role === "user") {
          const div = document.createElement("div");
          div.className = "agent-msg agent-msg-user";
          div.appendChild(createMsgHead("你", m.content));
          const body = document.createElement("div");
          body.className = "agent-msg-body";
          body.innerHTML = `<pre>${escapeHtml(m.content)}</pre>`;
          div.appendChild(body);
          els.messages.appendChild(div);
          i++;
          continue;
        }
        const group = [];
        while (i < session.messages.length && session.messages[i].role !== "user") {
          group.push(session.messages[i++]);
        }
        els.messages.appendChild(renderAgentGroup(group));
      }
    }

    if (sending && session.id === runningSessionId && liveStream?.div) {
      els.messages.appendChild(liveStream.div);
    }

    els.messages.scrollTop = els.messages.scrollHeight;
    updateFocusHint();
  }

  function updateFocusHint() {
    const ctx = hooks.getAgentContext();
    const label =
      ctx.tab === "phoneme" ? "音素表情" : ctx.tab === "scene" ? "情绪表情" : "源码文件";
    const expr = ctx.currentExpression;
    els.focusHint.textContent = `编辑焦点：${label} · ${expr?.title || expr?.name || "—"} · 工具：read / write · ${ctx.phonemeCount} 音素 + ${ctx.emotionCount} 情绪`;
  }

  function createStreamingBubble() {
    const div = document.createElement("div");
    div.className = "agent-msg agent-msg-assistant agent-msg-streaming";
    const head = document.createElement("div");
    head.className = "agent-msg-head agent-msg-head-live";

    const title = document.createElement("span");
    title.className = "agent-msg-title";
    title.textContent = "Agent";

    const badge = document.createElement("span");
    badge.className = "agent-msg-running";
    badge.textContent = "运行中";

    const abortBtn = document.createElement("button");
    abortBtn.type = "button";
    abortBtn.className = "btn sm agent-msg-abort";
    abortBtn.title = "中断运行";
    abortBtn.textContent = "⏹ 中断";
    abortBtn.onclick = () => abortAgentRun();

    head.appendChild(title);
    head.appendChild(badge);
    head.appendChild(createCopyButton(() => pre.textContent));
    head.appendChild(abortBtn);

    const body = document.createElement("div");
    body.className = "agent-msg-body";
    const pre = document.createElement("pre");
    pre.textContent = "";
    body.appendChild(pre);
    const toolsBox = document.createElement("div");
    toolsBox.className = "agent-tool-events agent-tool-events-live";
    div.appendChild(head);
    div.appendChild(body);
    div.appendChild(toolsBox);
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    return { div, pre, toolsBox, abortBtn };
  }

  function appendToolLive(toolsBox, text, isError = false) {
    const row = document.createElement("div");
    row.className = "agent-tool-event" + (isError ? " error" : "");
    row.textContent = text;
    toolsBox.appendChild(row);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function sendMessage() {
    const text = els.input.value.trim();
    if (!text || sending) return;
    saveConfigFromForm(true);

    const runSession = activeSession();
    const runSessionId = runSession.id;
    runSession.messages.push({ role: "user", content: text });
    if (runSession.messages.filter((m) => m.role === "user").length === 1) {
      runSession.title = text.slice(0, 18) + (text.length > 18 ? "…" : "");
    }
    els.input.value = "";
    renderSessions();
    renderMessages();
    persistAgentState();

    abortController = new AbortController();
    sending = true;
    runningSessionId = runSessionId;
    updateRunningUi();
    renderSessions();

    liveStream = createStreamingBubble();
    const stream = liveStream;
    let streamText = "";
    let roundText = "";
    let aborted = false;

    try {
      const ctx = hooks.getAgentContext();
      const system = buildAgentSystemPrompt(ctx);
      const apiMessages = [
        { role: "system", content: system },
        ...sessionToApiMessages(runSession.messages.slice(0, -1)),
        { role: "user", content: text },
      ];

      const result = await runAgentWithTools(
        config,
        apiMessages,
        AGENT_TOOLS,
        executeTool,
        {
          onContent: (_chunk, roundFull) => {
            roundText = roundFull;
            const sep = streamText && roundFull ? "\n\n" : "";
            stream.pre.textContent = streamText + sep + roundFull;
            scrollMessagesIfActive(runSessionId);
          },
          onAssistantDone: (msg) => {
            if (msg.content) {
              streamText += (streamText ? "\n\n" : "") + msg.content;
              roundText = "";
              stream.pre.textContent = streamText;
            }
          },
          onToolStart: (tc) => {
            const name = tc.function?.name;
            let args = {};
            try {
              args = JSON.parse(tc.function?.arguments || "{}");
            } catch {
              /* partial */
            }
            const icon = name === "write" ? "✏️" : "📖";
            appendToolLive(stream.toolsBox, `${icon} ${name}(${args.path || "…"}) …`);
            scrollMessagesIfActive(runSessionId);
          },
          onToolDone: (tc, result) => {
            const name = tc.function?.name;
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || "{}");
            } catch {
              /* ignore */
            }
            const isErr = String(result).startsWith("ERROR:");
            const icon = name === "write" ? "✏️" : "📖";
            appendToolLive(
              stream.toolsBox,
              `${icon} ${name}(${args.path}) → ${String(result).split("\n")[0]}`,
              isErr,
            );
            scrollMessagesIfActive(runSessionId);
            if (name === "write" && !isErr) {
              showToast("Agent 已通过 write 更新编辑器", "success");
            }
          },
        },
        abortController.signal,
      );

      aborted = !!result.aborted;
      const converted = apiMessagesToSession(result.newMessages);
      if (converted.length) {
        runSession.messages.push(...converted);
      } else if (streamText || roundText) {
        const partial = [streamText, roundText].filter(Boolean).join("\n\n");
        runSession.messages.push({ role: "assistant", content: partial });
      }
      if (aborted) {
        const last = runSession.messages[runSession.messages.length - 1];
        if (last?.role === "assistant" && last.content && !last.content.includes("（已中断）")) {
          last.content += "\n\n（已中断）";
        } else if (!last || last.role !== "assistant") {
          runSession.messages.push({ role: "assistant", content: "（已中断）" });
        }
        showToast("Agent 运行已中断", "success");
      }
      persistAgentState();
    } catch (e) {
      if (e.name === "AbortError") {
        aborted = true;
        const partial = [streamText, roundText].filter(Boolean).join("\n\n");
        runSession.messages.push({
          role: "assistant",
          content: partial ? `${partial}\n\n（已中断）` : "（已中断）",
        });
        persistAgentState();
        showToast("Agent 运行已中断", "success");
      } else {
        runSession.messages.push({
          role: "assistant",
          content: `请求失败：${e.message || e}`,
        });
        persistAgentState();
        showToast(String(e.message || e), "error");
      }
    } finally {
      abortController = null;
      sending = false;
      runningSessionId = null;
      liveStream?.div?.remove();
      liveStream = null;
      updateRunningUi();
      renderSessions();
      renderMessages();
    }
  }

  function applyLayoutCollapsed() {
    const layout = document.querySelector(".layout");
    if (!layout) return;
    layout.classList.toggle("agent-collapsed", collapsed);
  }

  function setCollapsed(next) {
    collapsed = next;
    localStorage.setItem("visemesync.agent.collapsed", collapsed ? "1" : "0");
    panel.classList.toggle("collapsed", collapsed);
    applyLayoutCollapsed();
    updateRunningUi();
  }

  function bindResize() {
    /* 固定宽度布局，不再拖动调整 Agent 列宽 */
  }

  els.toggle?.addEventListener("click", () => setCollapsed(!collapsed));
  els.btnSaveConfig?.addEventListener("click", saveConfigFromForm);
  els.btnNewSession?.addEventListener("click", () => {
    if (sending) {
      showToast("请等待当前对话完成或中断后再新建", "error");
      return;
    }
    const s = { id: uid(), title: `对话 ${sessions.length + 1}`, messages: [] };
    sessions.push(s);
    activeId = s.id;
    persistAgentState();
    renderSessions();
    renderMessages();
  });
  els.btnSend?.addEventListener("click", sendMessage);
  els.input?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  applyLayoutCollapsed();

  fillConfigForm();
  updateRunningUi();
  renderSessions();
  renderMessages();
  setCollapsed(collapsed);
  bindResize();

  return {
    refresh() {
      updateFocusHint();
    },
    getAgentState() {
      return {
        agentChatList: sessions,
        currentAgentChat: activeId,
      };
    },
    loadAgentState({ agentChatList, currentAgentChat }) {
      if (Array.isArray(agentChatList) && agentChatList.length) {
        sessions = structuredClone(agentChatList);
        activeId =
          currentAgentChat && sessions.some((s) => s.id === currentAgentChat)
            ? currentAgentChat
            : sessions[0].id;
      } else {
        const def = defaultAgentChats();
        sessions = def.agentChatList;
        activeId = def.currentAgentChat;
      }
      renderSessions();
      renderMessages();
    },
  };
}

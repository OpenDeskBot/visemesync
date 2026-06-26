/** OpenAI 兼容 API：流式 + 工具调用 */

export const DEFAULT_AGENT_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  temperature: 0.3,
};

export function loadAgentConfig() {
  try {
    const raw = localStorage.getItem("visemesync.agent.config");
    if (!raw) return { ...DEFAULT_AGENT_CONFIG };
    return { ...DEFAULT_AGENT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

export function saveAgentConfig(config) {
  localStorage.setItem("visemesync.agent.config", JSON.stringify(config));
}

function apiUrl(config) {
  const base = String(config.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("请设置 Base URL");
  if (!config.apiKey) throw new Error("请设置 API Key");
  if (!config.model) throw new Error("请设置 Model");
  return `${base}/chat/completions`;
}

function mergeToolCallDeltas(acc, deltas) {
  for (const d of deltas) {
    const idx = d.index ?? 0;
    if (!acc[idx]) {
      acc[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
    }
    if (d.id) acc[idx].id = d.id;
    if (d.function?.name) acc[idx].function.name += d.function.name;
    if (d.function?.arguments) acc[idx].function.arguments += d.function.arguments;
  }
  return acc;
}

/** 单次流式 completion，返回 assistant message */
export async function streamChatCompletion(config, messages, tools, handlers = {}, signal) {
  const url = apiUrl(config);
  const body = {
    model: config.model,
    messages,
    temperature: Number(config.temperature ?? 0.3),
    stream: true,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolAcc = {};

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          handlers.onContent?.(delta.content, content);
        }
        if (delta.tool_calls?.length) {
          mergeToolCallDeltas(toolAcc, delta.tool_calls);
          handlers.onToolCallDelta?.(delta.tool_calls, toolAcc);
        }
      }
    }
  } catch (e) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
    } else {
      throw e;
    }
  }

  if (signal?.aborted) {
    const err = new DOMException("Agent 运行已中断", "AbortError");
    err.partialContent = content;
    throw err;
  }

  const toolCalls = Object.keys(toolAcc)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => toolAcc[k])
    .filter((tc) => tc.function?.name);

  const msg = { role: "assistant", content: content || null };
  if (toolCalls.length) msg.tool_calls = toolCalls;
  return msg;
}

/** 流式 + 工具循环直到无 tool_calls */
export async function runAgentWithTools(config, messages, tools, executeTool, handlers = {}, signal) {
  const startLen = messages.length;
  const maxRounds = 12;

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted) {
      return { transcript: messages, newMessages: messages.slice(startLen), aborted: true };
    }

    handlers.onRoundStart?.(round);

    let assistantMsg;
    try {
      assistantMsg = await streamChatCompletion(config, messages, tools, {
        onContent: handlers.onContent,
        onToolCallDelta: handlers.onToolCallDelta,
      }, signal);
    } catch (e) {
      if (e.name === "AbortError") {
        const partial = e.partialContent;
        if (partial) {
          const msg = { role: "assistant", content: partial };
          messages.push(msg);
        }
        return { transcript: messages, newMessages: messages.slice(startLen), aborted: true };
      }
      throw e;
    }

    messages.push(assistantMsg);
    handlers.onAssistantDone?.(assistantMsg, round);

    const toolCalls = assistantMsg.tool_calls || [];
    if (!toolCalls.length) {
      return { transcript: messages, newMessages: messages.slice(startLen) };
    }

    for (const tc of toolCalls) {
      if (signal?.aborted) {
        return { transcript: messages, newMessages: messages.slice(startLen), aborted: true };
      }
      handlers.onToolStart?.(tc);
      let result;
      try {
        const args = JSON.parse(tc.function.arguments || "{}");
        result = await executeTool(tc.function.name, args);
      } catch (e) {
        result = `ERROR: ${e.message || e}`;
      }
      const toolMsg = { role: "tool", tool_call_id: tc.id, content: String(result) };
      messages.push(toolMsg);
      handlers.onToolDone?.(tc, result);
    }
  }

  throw new Error("工具调用轮次过多，已中止");
}

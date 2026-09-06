// ============================================================
// Parse-model providers. Policy: the agent must run at zero marginal
// cost on hardware the league owner already has. A local Ollama server
// is therefore the preferred provider; the metered Anthropic API is
// strictly opt-in (only used when the owner has set ANTHROPIC_API_KEY,
// or forced it via AGENT_PROVIDER=anthropic).
//
// Both providers are exposed through the same MinimalAnthropicClient
// surface parse.ts already speaks, so parse.ts stays provider-blind.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import type {
  MinimalAnthropicClient,
  MinimalCreateParams,
  MinimalMessageResponse,
} from "./parse";

const OLLAMA_DEFAULT_MODEL = "qwen2.5:7b";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const OLLAMA_TIMEOUT_MS = 60_000; // cold model loads are slow on first call

export type ResolvedProvider = {
  client: MinimalAnthropicClient;
  model: string;
  provider: "ollama" | "anthropic";
};

type OllamaToolCall = {
  function: { name: string; arguments: unknown };
};
type OllamaChatResponse = {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done_reason?: string;
};

const TEXT_TOOL_CALL_MAX_CHARS = 4000;

/**
 * Some Ollama model templates (Hermes 3 tags, observed live) don't emit a
 * structured `tool_calls` array — they print the call as text, either in
 * Hermes' native `<tool_call>{...}</tool_call>` wrapper or as a bare
 * Python-dict-looking object surrounded by stray tokens. Recover exactly one
 * call from such text, strictly bounded: the tool name must be one we
 * declared, the arguments must be an object, and anything else yields null
 * so parse.ts degrades to `unknown` as before. Field-level validation still
 * happens downstream in mapToolUse.
 */
export function extractTextToolCall(
  content: string | undefined,
  toolNames: readonly string[]
): { name: string; input: Record<string, unknown> } | null {
  if (!content || toolNames.length === 0) return null;
  const text = content.slice(0, TEXT_TOOL_CALL_MAX_CHARS);

  const wrapped = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i.exec(text);
  const candidate = wrapped ? wrapped[1] : firstBalancedObject(text);
  if (!candidate) return null;

  const parsed = parseLooseJson(candidate);
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Accept {name, arguments|parameters|input} or OpenAI-style {function:{...}}.
  const fn =
    obj.function && typeof obj.function === "object"
      ? (obj.function as Record<string, unknown>)
      : obj;
  const name = fn.name;
  if (typeof name !== "string" || !toolNames.includes(name)) return null;

  let args: unknown = fn.arguments ?? fn.parameters ?? fn.input ?? {};
  if (typeof args === "string") args = parseLooseJson(args);
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  return { name, input: args as Record<string, unknown> };
}

/** First `{…}` block with balanced braces, skipping braces inside quotes. */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** JSON.parse, falling back to Python-dict syntax (single quotes, True/None). */
function parseLooseJson(raw: string): unknown {
  const trimmed = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed.includes('"')) return null;
    const pythonish = trimmed
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    try {
      return JSON.parse(pythonish);
    } catch {
      return null;
    }
  }
}

/**
 * Adapts Ollama's /api/chat (with function tools) to the Anthropic-shaped
 * client surface. Ollama has no tool_choice forcing; the system prompt
 * already demands a tool call, and a response without one maps to an
 * empty content list, which parse.ts degrades to {kind:"unknown"}.
 */
export function createOllamaClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): MinimalAnthropicClient {
  return {
    messages: {
      async create(params: MinimalCreateParams): Promise<MinimalMessageResponse> {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
          body: JSON.stringify({
            model: params.model,
            stream: false,
            options: { temperature: 0 },
            messages: [
              { role: "system", content: params.system },
              ...params.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            tools: params.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              },
            })),
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 200)}`);
        }
        const data = (await response.json()) as OllamaChatResponse;
        const call = data.message?.tool_calls?.[0];
        if (!call) {
          // A response cut off at the token limit can't be trusted even if a
          // call-shaped fragment is visible in the text.
          if (data.done_reason !== "length") {
            const recovered = extractTextToolCall(
              data.message?.content,
              params.tools.map((tool) => tool.name)
            );
            if (recovered) {
              return {
                content: [{ type: "tool_use", name: recovered.name, input: recovered.input }],
                stop_reason: "tool_use",
              };
            }
          }
          return { content: [], stop_reason: data.done_reason ?? "end_turn" };
        }
        // Ollama returns arguments as an object; older builds returned a
        // JSON string. Accept both.
        const args = call.function.arguments;
        const input = typeof args === "string" ? JSON.parse(args) : args;
        return {
          content: [{ type: "tool_use", name: call.function.name, input }],
          stop_reason: "tool_use",
        };
      },
    },
  };
}

/**
 * Provider resolution:
 *   1. AGENT_PROVIDER=ollama|anthropic forces that provider.
 *   2. Otherwise OLLAMA_URL (if set) wins — free beats metered.
 *   3. Otherwise ANTHROPIC_API_KEY (if the owner set one) is used.
 *   4. Otherwise null — the orchestrator replies that the agent is offline.
 * AGENT_MODEL overrides the per-provider default model.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ResolvedProvider | null {
  const forced = env.AGENT_PROVIDER;
  const ollamaUrl = env.OLLAMA_URL;
  const anthropicKey = env.ANTHROPIC_API_KEY;

  const ollama = (): ResolvedProvider | null => {
    if (!ollamaUrl && forced !== "ollama") return null;
    return {
      client: createOllamaClient(ollamaUrl ?? "http://127.0.0.1:11434"),
      model: env.AGENT_MODEL ?? OLLAMA_DEFAULT_MODEL,
      provider: "ollama",
    };
  };
  const anthropic = (): ResolvedProvider | null => {
    if (!anthropicKey) return null;
    return {
      client: new Anthropic() as unknown as MinimalAnthropicClient,
      model: env.AGENT_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
      provider: "anthropic",
    };
  };

  if (forced === "ollama") return ollama();
  if (forced === "anthropic") return anthropic();
  return ollama() ?? anthropic();
}

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

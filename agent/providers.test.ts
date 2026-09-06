import assert from "node:assert/strict";
import test from "node:test";
import type { MinimalCreateParams } from "./parse";
import { createOllamaClient, extractTextToolCall, resolveProvider } from "./providers";

const PARAMS: MinimalCreateParams = {
  model: "qwen2.5:7b",
  max_tokens: 500,
  system: "You are the board.",
  messages: [{ role: "user", content: "<member_message>\nhi\n</member_message>" }],
  tools: [
    {
      name: "board_query",
      description: "Show the board.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  tool_choice: { type: "any" },
};

const fakeFetch = (body: unknown, ok = true, status = 200) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
  return { impl, calls };
};

test("ollama adapter translates the request to /api/chat function-tool shape", async () => {
  const { impl, calls } = fakeFetch({
    message: { tool_calls: [{ function: { name: "board_query", arguments: {} } }] },
  });
  const client = createOllamaClient("http://127.0.0.1:11434/", impl);
  await client.messages.create(PARAMS);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.model, "qwen2.5:7b");
  assert.equal(sent.stream, false);
  assert.deepEqual(sent.messages[0], { role: "system", content: "You are the board." });
  assert.match(sent.messages[1].content, /<member_message>/);
  assert.equal(sent.tools[0].type, "function");
  assert.equal(sent.tools[0].function.name, "board_query");
  assert.deepEqual(sent.tools[0].function.parameters, PARAMS.tools[0].input_schema);
});

test("ollama adapter maps a tool call back to Anthropic tool_use shape", async () => {
  const { impl } = fakeFetch({
    message: {
      tool_calls: [
        { function: { name: "create_tee_time", arguments: { course: "Common Ground", date: "2026-08-08", time: "08:40", spots: 2 } } },
      ],
    },
  });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(PARAMS);
  assert.equal(res.stop_reason, "tool_use");
  assert.equal(res.content[0].type, "tool_use");
  assert.equal(res.content[0].name, "create_tee_time");
  assert.deepEqual(res.content[0].input, {
    course: "Common Ground",
    date: "2026-08-08",
    time: "08:40",
    spots: 2,
  });
});

test("ollama adapter accepts stringified arguments from older builds", async () => {
  const { impl } = fakeFetch({
    message: { tool_calls: [{ function: { name: "board_query", arguments: "{\"a\":1}" } }] },
  });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(PARAMS);
  assert.deepEqual(res.content[0].input, { a: 1 });
});

test("ollama adapter: no tool call maps to empty content (parse degrades to unknown)", async () => {
  const { impl } = fakeFetch({ message: { content: "Sure! What day?" }, done_reason: "stop" });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(PARAMS);
  assert.deepEqual(res.content, []);
  assert.equal(res.stop_reason, "stop");
});

test("ollama adapter throws on HTTP errors with the body excerpt", async () => {
  const { impl } = fakeFetch({ error: "model not found" }, false, 404);
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  await assert.rejects(
    () => client.messages.create(PARAMS),
    /Ollama HTTP 404/
  );
});

test("resolution: OLLAMA_URL beats ANTHROPIC_API_KEY (free beats metered)", () => {
  const provider = resolveProvider({
    OLLAMA_URL: "http://127.0.0.1:11434",
    ANTHROPIC_API_KEY: "sk-test",
  } as NodeJS.ProcessEnv);
  assert.equal(provider?.provider, "ollama");
  assert.equal(provider?.model, "qwen2.5:7b");
});

test("resolution: AGENT_PROVIDER=anthropic forces the metered path when a key exists", () => {
  const provider = resolveProvider({
    OLLAMA_URL: "http://127.0.0.1:11434",
    ANTHROPIC_API_KEY: "sk-test",
    AGENT_PROVIDER: "anthropic",
  } as NodeJS.ProcessEnv);
  assert.equal(provider?.provider, "anthropic");
  assert.equal(provider?.model, "claude-haiku-4-5");
});

test("resolution: AGENT_PROVIDER=anthropic without a key resolves to nothing", () => {
  const provider = resolveProvider({ AGENT_PROVIDER: "anthropic" } as NodeJS.ProcessEnv);
  assert.equal(provider, null);
});

test("resolution: AGENT_PROVIDER=ollama works without OLLAMA_URL (localhost default)", () => {
  const provider = resolveProvider({ AGENT_PROVIDER: "ollama" } as NodeJS.ProcessEnv);
  assert.equal(provider?.provider, "ollama");
});

test("resolution: nothing configured resolves to nothing (agent offline)", () => {
  assert.equal(resolveProvider({} as NodeJS.ProcessEnv), null);
});

test("resolution: AGENT_MODEL overrides the per-provider default", () => {
  const provider = resolveProvider({
    OLLAMA_URL: "http://127.0.0.1:11434",
    AGENT_MODEL: "llama3.2:3b",
  } as NodeJS.ProcessEnv);
  assert.equal(provider?.model, "llama3.2:3b");
});

// -------- text-rendered tool calls (Hermes-style templates) --------

const TOOLS_WITH_CREATE: MinimalCreateParams = {
  ...PARAMS,
  tools: [
    ...PARAMS.tools,
    {
      name: "create_tee_time",
      description: "Post a tee time.",
      input_schema: { type: "object", properties: {}, additionalProperties: true },
    },
  ],
};

test("ollama adapter recovers a Hermes <tool_call> rendered as text", async () => {
  const { impl } = fakeFetch({
    message: {
      content:
        '<tool_call>\n{"name": "create_tee_time", "arguments": {"course": "Common Ground", "date": "2026-08-08", "time": "08:40", "spots": 2}}\n</tool_call>',
    },
    done_reason: "stop",
  });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(TOOLS_WITH_CREATE);
  assert.equal(res.stop_reason, "tool_use");
  assert.equal(res.content[0].name, "create_tee_time");
  assert.deepEqual(res.content[0].input, {
    course: "Common Ground",
    date: "2026-08-08",
    time: "08:40",
    spots: 2,
  });
});

test("ollama adapter recovers the exact hermes3:3b output observed live (python-dict + stray tokens)", async () => {
  const { impl } = fakeFetch({
    message: {
      content:
        "\"./\n  { 'arguments': { 'course': 'Todd Creek', 'date': '2026-08-08', 'spots': 4, 'time': '12:20' }, 'name': 'create_tee_time' }\n.SEVERI",
    },
    done_reason: "stop",
  });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(TOOLS_WITH_CREATE);
  assert.equal(res.stop_reason, "tool_use");
  assert.equal(res.content[0].name, "create_tee_time");
  assert.deepEqual(res.content[0].input, {
    course: "Todd Creek",
    date: "2026-08-08",
    spots: 4,
    time: "12:20",
  });
});

test("text fallback rejects tools that were not declared", () => {
  const found = extractTextToolCall(
    '{"name": "delete_everything", "arguments": {}}',
    ["board_query", "create_tee_time"]
  );
  assert.equal(found, null);
});

test("text fallback ignores prose and malformed fragments", () => {
  assert.equal(extractTextToolCall("Sure! What day works?", ["board_query"]), null);
  assert.equal(extractTextToolCall("{ not json at all", ["board_query"]), null);
  assert.equal(extractTextToolCall('{"name": "board_query", "arguments": "oops"}', ["board_query"]), null);
  assert.equal(extractTextToolCall(undefined, ["board_query"]), null);
});

test("text fallback accepts OpenAI-style {function:{name,arguments}} and stringified arguments", () => {
  const found = extractTextToolCall(
    '```json\n{"function": {"name": "board_query", "arguments": "{}"}}\n```',
    ["board_query"]
  );
  assert.deepEqual(found, { name: "board_query", input: {} });
});

test("ollama adapter does not trust a text tool call cut off at the token limit", async () => {
  const { impl } = fakeFetch({
    message: { content: '<tool_call>{"name": "board_query", "arguments": {}}' },
    done_reason: "length",
  });
  const client = createOllamaClient("http://127.0.0.1:11434", impl);
  const res = await client.messages.create(PARAMS);
  assert.deepEqual(res.content, []);
  assert.equal(res.stop_reason, "length");
});

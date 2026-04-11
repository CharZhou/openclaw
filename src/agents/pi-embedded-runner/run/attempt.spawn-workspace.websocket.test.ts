import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveProviderWebSocketSessionPolicyWithPlugin = vi.hoisted(() => vi.fn());

vi.mock("../../../plugins/provider-runtime.js", () => ({
  resolveProviderWebSocketSessionPolicyWithPlugin,
}));

import { shouldUseOpenAIWebSocketTransport } from "./attempt.thread-helpers.js";

describe("openai websocket transport selection", () => {
  beforeEach(() => {
    resolveProviderWebSocketSessionPolicyWithPlugin.mockReset();
  });

  it("accepts the direct OpenAI responses transport pair", () => {
    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "openai",
        modelApi: "openai-responses",
      }),
    ).toBe(true);
  });

  it("rejects mismatched OpenAI websocket transport pairs", () => {
    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "openai",
        modelApi: "openai-codex-responses",
      }),
    ).toBe(false);
    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "openai-codex",
        modelApi: "openai-responses",
      }),
    ).toBe(false);
    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "openai-codex",
        modelApi: "openai-codex-responses",
      }),
    ).toBe(false);
    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "anthropic",
        modelApi: "openai-responses",
      }),
    ).toBe(false);
  });

  it("accepts provider-owned websocket policy for custom openai-responses providers", () => {
    resolveProviderWebSocketSessionPolicyWithPlugin.mockReturnValue({
      degradeCooldownMs: 60_000,
    });

    expect(
      shouldUseOpenAIWebSocketTransport({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        modelApi: "openai-responses",
        model: {
          provider: "sub2api-openai",
          id: "gpt-5.4",
          name: "gpt-5.4",
          api: "openai-responses",
          baseUrl: "https://sub2api.example.com",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_050_000,
          maxTokens: 128_000,
        },
      }),
    ).toBe(true);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import type { ProviderPlugin } from "../../src/plugins/types.js";
import {
  registerProviderPlugin,
  requireRegisteredProvider,
} from "../../test/helpers/plugins/provider-registration.js";
import sub2apiPlugin from "./index.js";

let openaiProvider: ProviderPlugin;
let anthropicProvider: ProviderPlugin;

beforeAll(async () => {
  const registered = await registerProviderPlugin({
    plugin: sub2apiPlugin,
    id: "sub2api",
    name: "Sub2API",
  });
  openaiProvider = requireRegisteredProvider(registered.providers, "sub2api-openai");
  anthropicProvider = requireRegisteredProvider(registered.providers, "sub2api-anthropic");
});

describe("sub2api provider runtime contract", () => {
  it("keeps OpenAI runtime hooks provider-owned", () => {
    const model = openaiProvider.resolveDynamicModel?.({
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      config: {
        models: {
          providers: {
            "sub2api-openai": {
              baseUrl: "https://sub2api.example.com/openai/v1",
              models: [],
            },
          },
        },
      },
      modelRegistry: { find: () => null },
    } as never);

    expect(model).toMatchObject({
      id: "gpt-5.4",
      provider: "sub2api-openai",
      api: "openai-responses",
      baseUrl: "https://sub2api.example.com/openai/v1",
    });
    expect(
      openaiProvider.buildReplayPolicy?.({
        provider: "sub2api-openai",
        modelApi: "openai-responses",
        modelId: "gpt-5.4",
      } as never),
    ).toMatchObject({
      applyAssistantFirstOrderingFix: false,
      sanitizeToolCallIds: false,
    });
    expect(
      openaiProvider.normalizeTransport?.({
        provider: "sub2api-openai",
        api: "openai-completions",
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as never),
    ).toEqual({
      api: "openai-responses",
      baseUrl: "https://sub2api.example.com/openai/v1",
    });
    expect(
      openaiProvider.resolveTransportTurnState?.({
        provider: "sub2api-openai",
        sessionId: "sess-1",
        turnId: "turn-1",
        attempt: 1,
        transport: "websocket",
        model: {
          provider: "sub2api-openai",
          id: "gpt-5.4",
          api: "openai-responses",
          baseUrl: "https://sub2api.example.com/openai/v1",
        },
      } as never),
    ).toMatchObject({
      headers: expect.objectContaining({
        "x-client-request-id": "sess-1",
        "x-openclaw-session-id": "sess-1",
      }),
    });
    expect(
      openaiProvider.resolveWebSocketSessionPolicy?.({
        provider: "sub2api-openai",
        sessionId: "sess-1",
        model: {
          provider: "sub2api-openai",
          id: "gpt-5.4",
          api: "openai-responses",
          baseUrl: "https://sub2api.example.com/openai/v1",
        },
      } as never),
    ).toMatchObject({
      degradeCooldownMs: 60_000,
    });
    expect(
      openaiProvider.normalizeResolvedModel?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        config: {
          agents: {
            defaults: {
              models: {
                "sub2api-openai/gpt-5.4": {
                  params: {
                    codexContextTokens: 272000,
                  },
                },
              },
            },
          },
        },
        model: {
          provider: "sub2api-openai",
          id: "gpt-5.4",
          api: "openai-responses",
          baseUrl: "https://sub2api.example.com/openai/v1",
          contextWindow: 1_050_000,
          maxTokens: 128_000,
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      } as never),
    ).toMatchObject({
      contextTokens: 272000,
    });
    expect(
      openaiProvider.prepareExtraParams?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        extraParams: {},
      } as never),
    ).toMatchObject({
      transport: "auto",
    });
    expect(
      openaiProvider.resolveReasoningOutputMode?.({
        provider: "sub2api-openai",
        modelApi: "openai-responses",
        modelId: "gpt-5.4",
      } as never),
    ).toBe("native");
  });

  it("keeps Anthropic runtime hooks provider-owned", () => {
    const model = anthropicProvider.resolveDynamicModel?.({
      provider: "sub2api-anthropic",
      modelId: "claude-sonnet-4-6",
      config: {
        models: {
          providers: {
            "sub2api-anthropic": {
              baseUrl: "https://sub2api.example.com/anthropic/v1",
              models: [],
            },
          },
        },
      },
      modelRegistry: { find: () => null },
    } as never);

    expect(model).toMatchObject({
      id: "claude-sonnet-4-6",
      provider: "sub2api-anthropic",
      api: "anthropic-messages",
      baseUrl: "https://sub2api.example.com/anthropic/v1",
    });
    expect(
      anthropicProvider.buildReplayPolicy?.({
        provider: "sub2api-anthropic",
        modelApi: "anthropic-messages",
        modelId: "claude-sonnet-4-6",
      } as never),
    ).toMatchObject({
      sanitizeMode: "full",
      sanitizeToolCallIds: true,
      preserveNativeAnthropicToolUseIds: true,
      validateAnthropicTurns: true,
    });
    expect(
      anthropicProvider.resolveDefaultThinkingLevel?.({
        provider: "sub2api-anthropic",
        modelId: "claude-sonnet-4-6",
      } as never),
    ).toBe("adaptive");
    expect(
      anthropicProvider.resolveReasoningOutputMode?.({
        provider: "sub2api-anthropic",
        modelApi: "anthropic-messages",
        modelId: "claude-sonnet-4-6",
      } as never),
    ).toBe("native");
    expect(
      anthropicProvider.isCacheTtlEligible?.({
        provider: "sub2api-anthropic",
        modelId: "claude-sonnet-4-6",
      } as never),
    ).toBe(true);
    expect(
      anthropicProvider.wrapStreamFn?.({
        provider: "sub2api-anthropic",
        modelId: "claude-sonnet-4-6",
        extraParams: { anthropicBeta: "test-beta" },
        streamFn: undefined,
      } as never),
    ).toEqual(expect.any(Function));
  });
});

import fs from "node:fs";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { capturePluginRegistration } from "openclaw/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import {
  buildSub2ApiAnthropicProvider,
  buildSub2ApiOpenAIProvider,
  SUB2API_ANTHROPIC_PROVIDER_ID,
  SUB2API_OPENAI_PROVIDER_ID,
} from "./api.js";
import sub2apiPlugin from "./index.js";

function resolveProviderApiKey(apiKey: string | undefined) {
  return () => ({
    apiKey,
    discoveryApiKey: apiKey,
  });
}

function createPrompterWithTextResponses(...responses: string[]) {
  let index = 0;
  return {
    text: vi.fn(async () => responses[index++] ?? ""),
    confirm: vi.fn(async () => false),
    select: vi.fn(async () => "plaintext"),
    note: vi.fn(async () => undefined),
  };
}

function expectSingleProviderResult(
  result:
    | { provider: Record<string, unknown> }
    | { providers: Record<string, Record<string, unknown>> }
    | null
    | undefined,
) {
  expect(result).toBeTruthy();
  if (!result || !("provider" in result)) {
    throw new Error("expected single-provider catalog result");
  }
  return result.provider;
}

function runWrappedPayloadCase(params: {
  wrap: NonNullable<ReturnType<typeof buildSub2ApiOpenAIProvider>["wrapStreamFn"]>;
  provider: string;
  modelId: string;
  model: Model<"openai-responses">;
  extraParams?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  context?: Context;
}) {
  const payload = params.payload ?? {};
  let capturedModel: Model<"openai-responses"> | undefined;
  let capturedOptions:
    | (SimpleStreamOptions & {
        openaiWsWarmup?: boolean;
        cacheRetention?: "none" | "short" | "long";
      })
    | undefined;
  const baseStreamFn: StreamFn = (model, _context, options) => {
    capturedModel = model as Model<"openai-responses">;
    capturedOptions = options as
      | (SimpleStreamOptions & {
          openaiWsWarmup?: boolean;
          cacheRetention?: "none" | "short" | "long";
        })
      | undefined;
    options?.onPayload?.(payload, model);
    return {} as ReturnType<StreamFn>;
  };

  const streamFn = params.wrap({
    provider: params.provider,
    modelId: params.modelId,
    extraParams: params.extraParams,
    config: {} as never,
    agentDir: "/tmp/sub2api-openai-test",
    streamFn: baseStreamFn,
    model: params.model as never,
  } as never);

  const context: Context = params.context ?? { messages: [] };
  void streamFn?.(params.model, context, {});

  return {
    model: capturedModel,
    payload,
    options: capturedOptions,
  };
}

describe("sub2api plugin", () => {
  it("registers the expected providers and media-understanding surfaces", () => {
    const captured = capturePluginRegistration({ register: sub2apiPlugin.register });

    expect(captured.providers.map((provider) => provider.id)).toEqual([
      SUB2API_OPENAI_PROVIDER_ID,
      SUB2API_ANTHROPIC_PROVIDER_ID,
    ]);
    expect(captured.mediaUnderstandingProviders.map((provider) => provider.id)).toEqual([
      SUB2API_OPENAI_PROVIDER_ID,
      SUB2API_ANTHROPIC_PROVIDER_ID,
    ]);
  });

  it("keeps both auth choices explicit in the manifest", () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
    ) as {
      providerAuthChoices?: Array<{ choiceId?: string; provider?: string }>;
    };

    expect(manifest.providerAuthChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: SUB2API_OPENAI_PROVIDER_ID,
          choiceId: "sub2api-openai-api-key",
        }),
        expect.objectContaining({
          provider: SUB2API_ANTHROPIC_PROVIDER_ID,
          choiceId: "sub2api-anthropic-api-key",
        }),
      ]),
    );
  });
});

describe("sub2api-openai provider", () => {
  it("uses a custom auth flow that prompts for baseUrl and api key", async () => {
    const provider = buildSub2ApiOpenAIProvider();
    const prompter = createPrompterWithTextResponses(
      "https://sub2api.example.com/openai/v1",
      "openai-key",
    );

    const result = await provider.auth[0]?.run({
      config: {},
      env: {},
      opts: {},
      secretInputMode: "plaintext",
      allowSecretRefPrompt: false,
      prompter,
      runtime: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
      isRemote: false,
      openUrl: async () => {},
      oauth: { createVpsAwareHandlers: vi.fn() },
    } as never);

    expect(result?.profiles).toEqual([
      expect.objectContaining({
        profileId: "sub2api-openai:default",
        credential: expect.objectContaining({
          type: "api_key",
          provider: "sub2api-openai",
          key: "openai-key",
        }),
      }),
    ]);
    expect(result?.configPatch?.models?.providers?.["sub2api-openai"]).toMatchObject({
      baseUrl: "https://sub2api.example.com/openai/v1",
      api: "openai-responses",
    });
    expect(result?.defaultModel).toBe("sub2api-openai/gpt-5.4");
  });

  it("keeps xhigh support aligned with the built-in GPT-5 list", () => {
    const provider = buildSub2ApiOpenAIProvider();

    expect(provider.supportsXHighThinking?.({ modelId: "gpt-5.4" } as never)).toBe(true);
    expect(provider.supportsXHighThinking?.({ modelId: "gpt-5.2" } as never)).toBe(true);
    expect(provider.supportsXHighThinking?.({ modelId: "o3" } as never)).toBe(false);
    expect(provider.supportsXHighThinking?.({ modelId: "gpt-5.1" } as never)).toBe(false);
  });

  it("keeps openaiWsWarmup disabled by default", () => {
    const provider = buildSub2ApiOpenAIProvider();

    expect(
      provider.prepareExtraParams?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        extraParams: {},
      } as never),
    ).toEqual({
      transport: "auto",
    });
  });

  it("passes configured toolResultModel through provider-owned extra params", () => {
    const provider = buildSub2ApiOpenAIProvider();

    expect(
      provider.prepareExtraParams?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        config: {
          agents: {
            defaults: {
              models: {
                "sub2api-openai/gpt-5.4": {
                  params: {
                    toolResultModel: "gpt-5.4-mini",
                  },
                },
              },
            },
          },
        },
        extraParams: {},
      } as never),
    ).toMatchObject({
      transport: "auto",
      toolResultModel: "gpt-5.4-mini",
    });
  });

  it("injects serviceTier into responses payloads", () => {
    const provider = buildSub2ApiOpenAIProvider();
    const wrap = provider.wrapStreamFn;
    expect(wrap).toBeTypeOf("function");
    if (!wrap) {
      throw new Error("expected Sub2API OpenAI wrapper");
    }

    const result = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {
        serviceTier: "priority",
      },
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      payload: {},
    });

    expect(result.payload.service_tier).toBe("priority");
  });

  it("injects responses server compaction when explicitly enabled", () => {
    const provider = buildSub2ApiOpenAIProvider();
    const wrap = provider.wrapStreamFn;
    expect(wrap).toBeTypeOf("function");
    if (!wrap) {
      throw new Error("expected Sub2API OpenAI wrapper");
    }

    const result = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {
        responsesServerCompaction: true,
      },
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        contextWindow: 1_050_000,
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      payload: {},
    });

    expect(result.payload.store).toBe(true);
    expect(result.payload.context_management).toEqual([
      {
        type: "compaction",
        compact_threshold: 735000,
      },
    ]);
  });

  it("passes cacheRetention through and adds long retention payload hints", () => {
    const provider = buildSub2ApiOpenAIProvider();
    const wrap = provider.wrapStreamFn;
    expect(wrap).toBeTypeOf("function");
    if (!wrap) {
      throw new Error("expected Sub2API OpenAI wrapper");
    }

    const result = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {
        cacheRetention: "long",
      },
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      payload: {},
    });

    expect(result.options?.cacheRetention).toBe("long");
    expect(result.payload.prompt_cache_retention).toBe("24h");
  });

  it("applies codexCodingDefaults as provider-owned defaults", () => {
    const provider = buildSub2ApiOpenAIProvider();

    expect(
      provider.prepareExtraParams?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        config: {
          agents: {
            defaults: {
              models: {
                "sub2api-openai/gpt-5.4": {
                  params: {
                    codexCodingDefaults: true,
                  },
                },
              },
            },
          },
        },
        extraParams: {},
      } as never),
    ).toMatchObject({
      transport: "auto",
      parallel_tool_calls: true,
      textVerbosity: "low",
    });
  });

  it("uses codexTextVerbosityProfile only when text verbosity is otherwise unset", () => {
    const provider = buildSub2ApiOpenAIProvider();

    expect(
      provider.prepareExtraParams?.({
        provider: "sub2api-openai",
        modelId: "gpt-5.4",
        config: {
          agents: {
            defaults: {
              models: {
                "sub2api-openai/gpt-5.4": {
                  params: {
                    codexTextVerbosityProfile: "high",
                  },
                },
              },
            },
          },
        },
        extraParams: {},
      } as never),
    ).toMatchObject({
      textVerbosity: "high",
    });
  });

  it("injects codexNativeWebSearch only when enabled", () => {
    const provider = buildSub2ApiOpenAIProvider();
    const wrap = provider.wrapStreamFn;
    expect(wrap).toBeTypeOf("function");
    if (!wrap) {
      throw new Error("expected Sub2API OpenAI wrapper");
    }

    const disabled = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {},
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      payload: {},
    });
    expect(disabled.payload.tools).toBeUndefined();

    const enabled = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {
        codexNativeWebSearch: true,
      },
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      payload: {},
    });
    expect(enabled.payload.tools).toEqual([
      expect.objectContaining({
        type: "web_search",
      }),
    ]);
  });

  it("routes toolResult follow-up turns to toolResultModel", () => {
    const provider = buildSub2ApiOpenAIProvider();
    const wrap = provider.wrapStreamFn;
    expect(wrap).toBeTypeOf("function");
    if (!wrap) {
      throw new Error("expected Sub2API OpenAI wrapper");
    }

    const result = runWrappedPayloadCase({
      wrap,
      provider: "sub2api-openai",
      modelId: "gpt-5.4",
      extraParams: {
        toolResultModel: "gpt-5.4-mini",
      },
      model: {
        api: "openai-responses",
        provider: "sub2api-openai",
        id: "gpt-5.4",
        name: "gpt-5.4",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_050_000,
        maxTokens: 128_000,
        baseUrl: "https://sub2api.example.com/openai/v1",
      } as Model<"openai-responses">,
      context: {
        messages: [
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "read_file",
            content: [{ type: "text", text: "done" }],
          } as never,
        ],
      },
      payload: {},
    });

    expect(result.model?.id).toBe("gpt-5.4-mini");
  });

  it("discovers OpenAI-compatible models from the gateway", async () => {
    const provider = buildSub2ApiOpenAIProvider();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.catalog?.run({
      config: {
        models: {
          providers: {
            [SUB2API_OPENAI_PROVIDER_ID]: {
              baseUrl: "https://sub2api.example.com/openai/v1",
            },
          },
        },
      },
      env: {},
      resolveProviderApiKey: resolveProviderApiKey("openai-key"),
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sub2api.example.com/openai/v1/models",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer openai-key",
        },
      }),
    );
    const resolvedProvider = expectSingleProviderResult(result);
    expect(resolvedProvider.api).toBe("openai-responses");
    expect(resolvedProvider.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gpt-5.4" }),
        expect.objectContaining({ id: "gpt-5.4-mini" }),
      ]),
    );
    vi.unstubAllGlobals();
  });

  it("falls back to configured models when discovery fails", async () => {
    const provider = buildSub2ApiOpenAIProvider();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("boom")));

    const result = await provider.catalog?.run({
      config: {
        models: {
          providers: {
            [SUB2API_OPENAI_PROVIDER_ID]: {
              baseUrl: "https://sub2api.example.com/openai/v1",
              models: [{ id: "gpt-fallback", name: "GPT Fallback" }],
            },
          },
        },
      },
      env: {},
      resolveProviderApiKey: resolveProviderApiKey("openai-key"),
    } as never);

    const resolvedProvider = expectSingleProviderResult(result);
    expect(resolvedProvider.models).toEqual([
      expect.objectContaining({
        id: "gpt-fallback",
        name: "GPT Fallback",
      }),
    ]);
    vi.unstubAllGlobals();
  });
});

describe("sub2api-anthropic provider", () => {
  it("uses a custom auth flow that prompts for baseUrl and api key", async () => {
    const provider = buildSub2ApiAnthropicProvider();
    const prompter = createPrompterWithTextResponses(
      "https://sub2api.example.com/anthropic/v1",
      "anthropic-key",
    );

    const result = await provider.auth[0]?.run({
      config: {},
      env: {},
      opts: {},
      secretInputMode: "plaintext",
      allowSecretRefPrompt: false,
      prompter,
      runtime: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
      isRemote: false,
      openUrl: async () => {},
      oauth: { createVpsAwareHandlers: vi.fn() },
    } as never);

    expect(result?.profiles).toEqual([
      expect.objectContaining({
        profileId: "sub2api-anthropic:default",
        credential: expect.objectContaining({
          type: "api_key",
          provider: "sub2api-anthropic",
          key: "anthropic-key",
        }),
      }),
    ]);
    expect(result?.configPatch?.models?.providers?.["sub2api-anthropic"]).toMatchObject({
      baseUrl: "https://sub2api.example.com/anthropic/v1",
      api: "anthropic-messages",
      models: [
        expect.objectContaining({
          id: "claude-sonnet-4-6",
          contextWindow: 1_000_000,
          cost: {
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: 3.75,
          },
        }),
      ],
    });
    expect(result?.defaultModel).toBe("sub2api-anthropic/claude-sonnet-4-6");
  });

  it("normalizes provider config to anthropic-messages", () => {
    const provider = buildSub2ApiAnthropicProvider();

    expect(
      provider.normalizeConfig?.({
        provider: SUB2API_ANTHROPIC_PROVIDER_ID,
        providerConfig: {
          baseUrl: "https://sub2api.example.com/anthropic/v1",
          models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }],
        },
      } as never),
    ).toMatchObject({
      api: "anthropic-messages",
    });
  });

  it("discovers Anthropic-compatible models from the gateway", async () => {
    const provider = buildSub2ApiAnthropicProvider();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
          { id: "claude-opus-4-6", display_name: "Claude Opus 4.6" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.catalog?.run({
      config: {
        models: {
          providers: {
            [SUB2API_ANTHROPIC_PROVIDER_ID]: {
              baseUrl: "https://sub2api.example.com/anthropic/v1",
            },
          },
        },
      },
      env: {},
      resolveProviderApiKey: resolveProviderApiKey("anthropic-key"),
    } as never);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sub2api.example.com/anthropic/v1/models",
      expect.objectContaining({
        headers: {
          "x-api-key": "anthropic-key",
          "anthropic-version": "2023-06-01",
        },
      }),
    );
    const resolvedProvider = expectSingleProviderResult(result);
    expect(resolvedProvider.api).toBe("anthropic-messages");
    expect(resolvedProvider.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-sonnet-4-6",
          contextWindow: 1_000_000,
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        }),
        expect.objectContaining({
          id: "claude-opus-4-6",
          contextWindow: 1_000_000,
          cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        }),
      ]),
    );
    vi.unstubAllGlobals();
  });

  it("applies Anthropic-style cache ttl defaults when auth is present", () => {
    const provider = buildSub2ApiAnthropicProvider();

    const next = provider.applyConfigDefaults?.({
      provider: SUB2API_ANTHROPIC_PROVIDER_ID,
      env: { SUB2API_ANTHROPIC_API_KEY: "anthropic-key" } as NodeJS.ProcessEnv,
      config: {
        agents: {
          defaults: {
            model: { primary: `${SUB2API_ANTHROPIC_PROVIDER_ID}/claude-sonnet-4-6` },
          },
        },
      },
    } as never);

    expect(next?.agents?.defaults?.contextPruning).toMatchObject({
      mode: "cache-ttl",
      ttl: "1h",
    });
    expect(next?.agents?.defaults?.heartbeat).toMatchObject({
      every: "30m",
    });
    expect(
      next?.agents?.defaults?.models?.[`${SUB2API_ANTHROPIC_PROVIDER_ID}/claude-sonnet-4-6`]?.params
        ?.cacheRetention,
    ).toBe("short");
  });

  it("supports non-interactive baseUrl setup", async () => {
    const provider = buildSub2ApiAnthropicProvider();
    const result = await provider.auth[0]?.runNonInteractive?.({
      authChoice: "sub2api-anthropic-api-key",
      config: {},
      baseConfig: {},
      opts: {
        customBaseUrl: "https://sub2api.example.com/anthropic/v1",
      },
      runtime: {
        log() {},
        error() {},
        exit(code?: number) {
          throw new Error(`unexpected exit ${code ?? 0}`);
        },
      },
      resolveApiKey: async () => ({
        key: "anthropic-key",
        source: "env",
        envVarName: "SUB2API_ANTHROPIC_API_KEY",
      }),
      toApiKeyCredential: ({ provider }: { provider: string }) => ({
        type: "api_key",
        provider,
        key: "anthropic-key",
      }),
    } as never);

    expect(result?.models?.providers?.["sub2api-anthropic"]).toMatchObject({
      baseUrl: "https://sub2api.example.com/anthropic/v1",
      api: "anthropic-messages",
    });
    expect(result?.auth?.profiles?.["sub2api-anthropic:default"]).toMatchObject({
      provider: "sub2api-anthropic",
      mode: "api_key",
    });
  });
});

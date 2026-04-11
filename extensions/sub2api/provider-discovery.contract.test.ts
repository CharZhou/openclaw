import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../src/config/config.js";
import { runProviderCatalog } from "../../src/plugins/provider-discovery.js";
import {
  registerProviderPlugin,
  requireRegisteredProvider,
} from "../../test/helpers/plugins/provider-registration.js";
import sub2apiPlugin from "./index.js";

type RegisteredProviders = Awaited<ReturnType<typeof registerProviderPlugin>>;

function resolveProviderApiKey(apiKey: string | undefined) {
  return () => ({
    apiKey,
    discoveryApiKey: apiKey,
  });
}

function resolveProviderAuth(apiKey: string | undefined) {
  return () => ({
    apiKey,
    discoveryApiKey: apiKey,
    mode: apiKey ? ("api_key" as const) : ("none" as const),
    source: apiKey ? ("env" as const) : ("none" as const),
  });
}

describe("sub2api provider discovery contract", () => {
  let registered: RegisteredProviders;

  beforeEach(async () => {
    registered = await registerProviderPlugin({
      plugin: sub2apiPlugin,
      id: "sub2api",
      name: "Sub2API",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps OpenAI-compatible catalog discovery provider-owned", async () => {
    const provider = requireRegisteredProvider(registered.providers, "sub2api-openai");
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runProviderCatalog({
        provider,
        config: {
          models: {
            providers: {
              "sub2api-openai": {
                baseUrl: "https://sub2api.example.com/openai/v1",
                models: [],
              },
            },
          },
        } as OpenClawConfig,
        env: {} as NodeJS.ProcessEnv,
        resolveProviderApiKey: resolveProviderApiKey("openai-key"),
        resolveProviderAuth: resolveProviderAuth("openai-key"),
      }),
    ).resolves.toEqual({
      provider: {
        baseUrl: "https://sub2api.example.com/openai/v1",
        api: "openai-responses",
        apiKey: "openai-key",
        models: expect.arrayContaining([
          expect.objectContaining({ id: "gpt-5.4" }),
          expect.objectContaining({ id: "gpt-5.4-mini" }),
        ]),
      },
    });
  });

  it("keeps Anthropic-compatible catalog discovery provider-owned", async () => {
    const provider = requireRegisteredProvider(registered.providers, "sub2api-anthropic");
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

    await expect(
      runProviderCatalog({
        provider,
        config: {
          models: {
            providers: {
              "sub2api-anthropic": {
                baseUrl: "https://sub2api.example.com/anthropic/v1",
                models: [],
              },
            },
          },
        } as OpenClawConfig,
        env: {} as NodeJS.ProcessEnv,
        resolveProviderApiKey: resolveProviderApiKey("anthropic-key"),
        resolveProviderAuth: resolveProviderAuth("anthropic-key"),
      }),
    ).resolves.toEqual({
      provider: {
        baseUrl: "https://sub2api.example.com/anthropic/v1",
        api: "anthropic-messages",
        apiKey: "anthropic-key",
        models: expect.arrayContaining([
          expect.objectContaining({ id: "claude-sonnet-4-6" }),
          expect.objectContaining({ id: "claude-opus-4-6" }),
        ]),
      },
    });
  });
});

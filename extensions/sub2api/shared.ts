import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ProviderRuntimeModel } from "openclaw/plugin-sdk/plugin-entry";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";

const DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

const SUB2API_ANTHROPIC_OPUS_46_COST = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite: 6.25,
} as const;

const SUB2API_ANTHROPIC_SONNET_46_COST = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
} as const;

const SUB2API_ANTHROPIC_1M_MODEL_PREFIXES = [
  "claude-opus-4-6",
  "claude-opus-4.6",
  "claude-sonnet-4-6",
  "claude-sonnet-4.6",
] as const;

const SUB2API_ANTHROPIC_MODERN_MODEL_PREFIXES = [
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-4",
] as const;

export function trimConfiguredBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveConfiguredProviderBaseUrl(
  config: OpenClawConfig | undefined,
  providerId: string,
): string | undefined {
  return trimConfiguredBaseUrl(config?.models?.providers?.[providerId]?.baseUrl);
}

export function readConfiguredProviderModels(
  config: OpenClawConfig | undefined,
  providerId: string,
  defaults: {
    reasoning: boolean;
    input: Array<"text" | "image">;
    contextWindow: number;
    maxTokens: number;
    resolveContextWindow?: (modelId: string, fallbackContextWindow: number) => number;
  },
): ModelDefinitionConfig[] {
  return readConfiguredProviderCatalogEntries({
    config,
    providerId,
  }).map((entry) => {
    const filteredInput =
      entry.input
        ?.filter((value): value is "text" | "image" => value === "text" || value === "image")
        .slice(0, 2) ?? [];
    return {
      id: entry.id,
      name: entry.name,
      reasoning: entry.reasoning ?? defaults.reasoning,
      input: filteredInput.length > 0 ? filteredInput : defaults.input,
      cost: DEFAULT_COST,
      contextWindow:
        entry.contextWindow ??
        defaults.resolveContextWindow?.(entry.id, defaults.contextWindow) ??
        defaults.contextWindow,
      maxTokens: defaults.maxTokens,
    };
  });
}

export function mergeModelCatalogs(
  ...catalogs: Array<ReadonlyArray<ModelDefinitionConfig>>
): ModelDefinitionConfig[] {
  const byId = new Map<string, ModelDefinitionConfig>();
  for (const catalog of catalogs) {
    for (const model of catalog) {
      const id = normalizeLowercaseStringOrEmpty(model.id);
      if (!id) {
        continue;
      }
      byId.set(id, model);
    }
  }
  return [...byId.values()];
}

export function buildOpenAiDynamicModel(params: {
  providerId: string;
  modelId: string;
  baseUrl?: string;
}): ProviderRuntimeModel {
  const reasoning = /^(gpt-5|o1|o3|o4)/i.test(params.modelId);
  const model = {
    id: params.modelId,
    name: params.modelId,
    reasoning,
    input: ["text", "image"] as Array<"text" | "image">,
    cost: DEFAULT_COST,
    contextWindow: 128_000,
    maxTokens: 128_000,
    api: "openai-responses" as const,
    provider: params.providerId,
  };
  return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
}

export function buildAnthropicDynamicModel(params: {
  providerId: string;
  modelId: string;
  baseUrl?: string;
}): ProviderRuntimeModel {
  const model = {
    id: params.modelId,
    name: params.modelId,
    reasoning: params.modelId.toLowerCase().includes("claude"),
    input: ["text", "image"] as Array<"text" | "image">,
    cost: resolveSub2ApiAnthropicCost(params.modelId),
    contextWindow: resolveSub2ApiAnthropicContextWindow(params.modelId),
    maxTokens: 8_192,
    api: "anthropic-messages" as const,
    provider: params.providerId,
  };
  return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
}

export function isSub2ApiAnthropic1MModel(modelId: string): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  return SUB2API_ANTHROPIC_1M_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function resolveSub2ApiAnthropicContextWindow(modelId: string): number {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  if (isSub2ApiAnthropic1MModel(normalized)) {
    return 1_000_000;
  }
  if (SUB2API_ANTHROPIC_MODERN_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 200_000;
  }
  return 128_000;
}

export function resolveSub2ApiAnthropicCost(modelId: string): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  if (normalized.startsWith("claude-opus-4-6") || normalized.startsWith("claude-opus-4.6")) {
    return SUB2API_ANTHROPIC_OPUS_46_COST;
  }
  if (normalized.startsWith("claude-sonnet-4-6") || normalized.startsWith("claude-sonnet-4.6")) {
    return SUB2API_ANTHROPIC_SONNET_46_COST;
  }
  return DEFAULT_COST;
}

export function buildProviderConfig(params: {
  baseUrl: string;
  apiKey: string;
  api: "openai-responses" | "anthropic-messages";
  models: ModelDefinitionConfig[];
}): ModelProviderConfig {
  return {
    baseUrl: params.baseUrl,
    api: params.api,
    apiKey: params.apiKey,
    models: params.models,
  };
}

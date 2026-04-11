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
      contextWindow: entry.contextWindow ?? defaults.contextWindow,
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
    cost: DEFAULT_COST,
    contextWindow: 200_000,
    maxTokens: 8_192,
    api: "anthropic-messages" as const,
    provider: params.providerId,
  };
  return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
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

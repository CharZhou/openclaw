import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  discoverOpenAICompatibleLocalModels,
  SELF_HOSTED_DEFAULT_CONTEXT_WINDOW,
  SELF_HOSTED_DEFAULT_MAX_TOKENS,
} from "openclaw/plugin-sdk/provider-setup";
import { SUB2API_OPENAI_PROVIDER_LABEL } from "./defaults.js";
import { resolveSub2ApiAnthropicContextWindow, resolveSub2ApiAnthropicCost } from "./shared.js";

type AnthropicModelsResponse = {
  data?: Array<{
    id?: string;
    display_name?: string;
  }>;
};

export async function discoverSub2ApiOpenAIModels(params: {
  baseUrl: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ModelDefinitionConfig[]> {
  return await discoverOpenAICompatibleLocalModels({
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    env: params.env,
    label: SUB2API_OPENAI_PROVIDER_LABEL,
    contextWindow: SELF_HOSTED_DEFAULT_CONTEXT_WINDOW,
    maxTokens: SELF_HOSTED_DEFAULT_MAX_TOKENS,
  });
}

export async function discoverSub2ApiAnthropicModels(params: {
  baseUrl: string;
  apiKey?: string;
}): Promise<ModelDefinitionConfig[]> {
  if (!params.apiKey) {
    return [];
  }
  const url = `${params.baseUrl.replace(/\/+$/, "")}/models`;
  try {
    const response = await fetch(url, {
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as AnthropicModelsResponse;
    const models = payload.data ?? [];
    const discovered: ModelDefinitionConfig[] = [];
    for (const entry of models) {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) {
        continue;
      }
      discovered.push({
        id,
        name:
          typeof entry.display_name === "string" && entry.display_name.trim().length > 0
            ? entry.display_name.trim()
            : id,
        reasoning: id.toLowerCase().includes("claude"),
        input: ["text", "image"],
        cost: resolveSub2ApiAnthropicCost(id),
        contextWindow: resolveSub2ApiAnthropicContextWindow(id),
        maxTokens: 8_192,
      });
    }
    return discovered;
  } catch {
    return [];
  }
}

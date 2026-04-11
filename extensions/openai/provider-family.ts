import type {
  ProviderPrepareExtraParamsContext,
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  DEFAULT_CONTEXT_TOKENS,
  normalizeModelCompat,
  normalizeProviderId,
} from "openclaw/plugin-sdk/provider-model-shared";
import { buildProviderStreamFamilyHooks } from "openclaw/plugin-sdk/provider-stream-family";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import {
  buildOpenAISyntheticCatalogEntry,
  cloneFirstTemplateModel,
  findCatalogTemplate,
  isOpenAIApiBaseUrl,
  matchesExactOrPrefix,
} from "./shared.js";

const PROVIDER_ID = "openai";
const OPENAI_GPT_54_MODEL_ID = "gpt-5.4";
const OPENAI_GPT_54_PRO_MODEL_ID = "gpt-5.4-pro";
const OPENAI_GPT_54_MINI_MODEL_ID = "gpt-5.4-mini";
const OPENAI_GPT_54_NANO_MODEL_ID = "gpt-5.4-nano";
const OPENAI_GPT_54_CONTEXT_TOKENS = 1_050_000;
const OPENAI_GPT_54_PRO_CONTEXT_TOKENS = 1_050_000;
const OPENAI_GPT_54_MINI_CONTEXT_TOKENS = 400_000;
const OPENAI_GPT_54_NANO_CONTEXT_TOKENS = 400_000;
const OPENAI_GPT_54_MAX_TOKENS = 128_000;
const OPENAI_GPT_54_COST = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 } as const;
const OPENAI_GPT_54_PRO_COST = { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 } as const;
const OPENAI_GPT_54_MINI_COST = {
  input: 0.75,
  output: 4.5,
  cacheRead: 0.075,
  cacheWrite: 0,
} as const;
const OPENAI_GPT_54_NANO_COST = {
  input: 0.2,
  output: 1.25,
  cacheRead: 0.02,
  cacheWrite: 0,
} as const;
const OPENAI_GPT_54_TEMPLATE_MODEL_IDS = ["gpt-5.2"] as const;
const OPENAI_GPT_54_PRO_TEMPLATE_MODEL_IDS = ["gpt-5.2-pro", "gpt-5.2"] as const;
const OPENAI_GPT_54_MINI_TEMPLATE_MODEL_IDS = ["gpt-5-mini"] as const;
const OPENAI_GPT_54_NANO_TEMPLATE_MODEL_IDS = ["gpt-5-nano", "gpt-5-mini"] as const;
const OPENAI_XHIGH_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
] as const;
const OPENAI_MODERN_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.2",
] as const;

export const OPENAI_RESPONSES_STREAM_HOOKS = buildProviderStreamFamilyHooks(
  "openai-responses-defaults",
);

export function shouldUseOpenAIResponsesTransport(params: {
  provider: string;
  api?: string | null;
  baseUrl?: string;
}): boolean {
  if (params.api !== "openai-completions") {
    return false;
  }
  const isOwnerProvider = normalizeProviderId(params.provider) === PROVIDER_ID;
  if (isOwnerProvider) {
    return !params.baseUrl || isOpenAIApiBaseUrl(params.baseUrl);
  }
  return typeof params.baseUrl === "string" && isOpenAIApiBaseUrl(params.baseUrl);
}

export function normalizeOpenAIResponsesTransport(
  model: ProviderRuntimeModel,
): ProviderRuntimeModel {
  const useResponsesTransport = shouldUseOpenAIResponsesTransport({
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
  });

  if (!useResponsesTransport) {
    return model;
  }

  return {
    ...model,
    api: "openai-responses",
  };
}

export function resolveOpenAIGpt54ForwardCompatModel(
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  const trimmedModelId = ctx.modelId.trim();
  const lower = normalizeLowercaseStringOrEmpty(trimmedModelId);
  let templateIds: readonly string[];
  let patch: Partial<ProviderRuntimeModel>;
  if (lower === OPENAI_GPT_54_MODEL_ID) {
    templateIds = OPENAI_GPT_54_TEMPLATE_MODEL_IDS;
    patch = {
      api: "openai-responses",
      provider: PROVIDER_ID,
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: OPENAI_GPT_54_COST,
      contextWindow: OPENAI_GPT_54_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
  } else if (lower === OPENAI_GPT_54_PRO_MODEL_ID) {
    templateIds = OPENAI_GPT_54_PRO_TEMPLATE_MODEL_IDS;
    patch = {
      api: "openai-responses",
      provider: PROVIDER_ID,
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: OPENAI_GPT_54_PRO_COST,
      contextWindow: OPENAI_GPT_54_PRO_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
  } else if (lower === OPENAI_GPT_54_MINI_MODEL_ID) {
    templateIds = OPENAI_GPT_54_MINI_TEMPLATE_MODEL_IDS;
    patch = {
      api: "openai-responses",
      provider: PROVIDER_ID,
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: OPENAI_GPT_54_MINI_COST,
      contextWindow: OPENAI_GPT_54_MINI_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
  } else if (lower === OPENAI_GPT_54_NANO_MODEL_ID) {
    templateIds = OPENAI_GPT_54_NANO_TEMPLATE_MODEL_IDS;
    patch = {
      api: "openai-responses",
      provider: PROVIDER_ID,
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      input: ["text", "image"],
      cost: OPENAI_GPT_54_NANO_COST,
      contextWindow: OPENAI_GPT_54_NANO_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
  } else {
    return undefined;
  }

  return (
    cloneFirstTemplateModel({
      providerId: PROVIDER_ID,
      modelId: trimmedModelId,
      templateIds,
      ctx,
      patch,
    }) ??
    normalizeModelCompat({
      id: trimmedModelId,
      name: trimmedModelId,
      ...patch,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: patch.contextWindow ?? DEFAULT_CONTEXT_TOKENS,
      maxTokens: patch.maxTokens ?? DEFAULT_CONTEXT_TOKENS,
    } as ProviderRuntimeModel)
  );
}

export function supportsOpenAIXHighThinking(modelId: string): boolean {
  return matchesExactOrPrefix(modelId, OPENAI_XHIGH_MODEL_IDS);
}

export function isOpenAIModernModelRef(modelId: string): boolean {
  return matchesExactOrPrefix(modelId, OPENAI_MODERN_MODEL_IDS);
}

export function buildOpenAIResponsesExtraParams(
  ctx: ProviderPrepareExtraParamsContext,
): Record<string, unknown> {
  const transport = ctx.extraParams?.transport;
  const hasSupportedTransport =
    transport === "auto" || transport === "sse" || transport === "websocket";
  const hasExplicitWarmup = typeof ctx.extraParams?.openaiWsWarmup === "boolean";
  return {
    ...ctx.extraParams,
    ...(hasSupportedTransport ? {} : { transport: "auto" }),
    ...(hasExplicitWarmup ? {} : { openaiWsWarmup: true }),
  };
}

export function augmentOpenAIGpt54CatalogEntries(params: {
  entries: Array<{ provider: string; id: string; name: string }>;
}) {
  const openAiGpt54Template = findCatalogTemplate({
    entries: params.entries,
    providerId: PROVIDER_ID,
    templateIds: OPENAI_GPT_54_TEMPLATE_MODEL_IDS,
  });
  const openAiGpt54ProTemplate = findCatalogTemplate({
    entries: params.entries,
    providerId: PROVIDER_ID,
    templateIds: OPENAI_GPT_54_PRO_TEMPLATE_MODEL_IDS,
  });
  const openAiGpt54MiniTemplate = findCatalogTemplate({
    entries: params.entries,
    providerId: PROVIDER_ID,
    templateIds: OPENAI_GPT_54_MINI_TEMPLATE_MODEL_IDS,
  });
  const openAiGpt54NanoTemplate = findCatalogTemplate({
    entries: params.entries,
    providerId: PROVIDER_ID,
    templateIds: OPENAI_GPT_54_NANO_TEMPLATE_MODEL_IDS,
  });
  return [
    buildOpenAISyntheticCatalogEntry(openAiGpt54Template, {
      id: OPENAI_GPT_54_MODEL_ID,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: OPENAI_GPT_54_CONTEXT_TOKENS,
    }),
    buildOpenAISyntheticCatalogEntry(openAiGpt54ProTemplate, {
      id: OPENAI_GPT_54_PRO_MODEL_ID,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: OPENAI_GPT_54_PRO_CONTEXT_TOKENS,
    }),
    buildOpenAISyntheticCatalogEntry(openAiGpt54MiniTemplate, {
      id: OPENAI_GPT_54_MINI_MODEL_ID,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: OPENAI_GPT_54_MINI_CONTEXT_TOKENS,
    }),
    buildOpenAISyntheticCatalogEntry(openAiGpt54NanoTemplate, {
      id: OPENAI_GPT_54_NANO_MODEL_ID,
      reasoning: true,
      input: ["text", "image"],
      contextWindow: OPENAI_GPT_54_NANO_CONTEXT_TOKENS,
    }),
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}

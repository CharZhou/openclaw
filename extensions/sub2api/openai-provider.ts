import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type {
  ProviderReplayPolicyContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import type {
  ModelProviderConfig,
  ProviderPlugin,
} from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeProviderId } from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import {
  SUB2API_GROUP_HINT,
  SUB2API_GROUP_ID,
  SUB2API_GROUP_LABEL,
  SUB2API_OPENAI_BASE_URL_PLACEHOLDER,
  SUB2API_OPENAI_DEFAULT_MODEL,
  SUB2API_OPENAI_DEFAULT_MODEL_REF,
  SUB2API_OPENAI_ENV_VAR,
  SUB2API_OPENAI_PROVIDER_ID,
  SUB2API_OPENAI_PROVIDER_LABEL,
  applySub2ApiOpenAIConfig,
} from "./defaults.js";
import { discoverSub2ApiOpenAIModels } from "./discovery.js";
import { supportsSub2ApiOpenAIXHigh, wrapSub2ApiOpenAIProviderStream } from "./openai-stream.js";
import {
  configureSub2ApiProviderNonInteractive,
  promptAndConfigureSub2ApiProviderAuth,
} from "./setup.js";
import {
  buildOpenAiDynamicModel,
  buildProviderConfig,
  mergeModelCatalogs,
  readConfiguredProviderModels,
  resolveConfiguredProviderBaseUrl,
  trimConfiguredBaseUrl,
} from "./shared.js";

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
const OPENAI_MODERN_MODEL_IDS = [
  OPENAI_GPT_54_MODEL_ID,
  OPENAI_GPT_54_PRO_MODEL_ID,
  OPENAI_GPT_54_MINI_MODEL_ID,
  OPENAI_GPT_54_NANO_MODEL_ID,
  "gpt-5.2",
] as const;
const DEFAULT_OPENAI_WS_DEGRADE_COOLDOWN_MS = 60_000;
type Sub2ApiCatalogEntry = {
  provider: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  contextTokens?: number;
};

function matchesExactOrPrefix(modelId: string, candidates: readonly string[]): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  return candidates.some(
    (candidate) =>
      normalized === candidate ||
      normalized.startsWith(`${candidate}-`) ||
      normalized.startsWith(`${candidate}.`),
  );
}

function isSub2ApiOpenAIModernModel(modelId: string): boolean {
  return matchesExactOrPrefix(modelId, OPENAI_MODERN_MODEL_IDS);
}

function resolveSub2ApiModelParams(
  config: OpenClawConfig | undefined,
  modelId: string,
): Record<string, unknown> | undefined {
  const modelRef = `${SUB2API_OPENAI_PROVIDER_ID}/${modelId}`;
  const entry = config?.agents?.defaults?.models?.[modelRef];
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const params = (entry as { params?: unknown }).params;
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : undefined;
}

function resolvePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function resolveCodexContextTokens(
  config: OpenClawConfig | undefined,
  modelId: string,
): number | undefined {
  return resolvePositiveInteger(resolveSub2ApiModelParams(config, modelId)?.codexContextTokens);
}

function resolveSub2ApiOpenAIForwardCompatModel(params: {
  modelId: string;
  baseUrl?: string;
}): ProviderRuntimeModel | undefined {
  const trimmedModelId = params.modelId.trim();
  const lower = normalizeLowercaseStringOrEmpty(trimmedModelId);
  if (lower === OPENAI_GPT_54_MODEL_ID) {
    const model = {
      id: trimmedModelId,
      name: trimmedModelId,
      api: "openai-responses" as const,
      provider: SUB2API_OPENAI_PROVIDER_ID,
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: OPENAI_GPT_54_COST,
      contextWindow: OPENAI_GPT_54_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
    return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
  }
  if (lower === OPENAI_GPT_54_PRO_MODEL_ID) {
    const model = {
      id: trimmedModelId,
      name: trimmedModelId,
      api: "openai-responses" as const,
      provider: SUB2API_OPENAI_PROVIDER_ID,
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: OPENAI_GPT_54_PRO_COST,
      contextWindow: OPENAI_GPT_54_PRO_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
    return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
  }
  if (lower === OPENAI_GPT_54_MINI_MODEL_ID) {
    const model = {
      id: trimmedModelId,
      name: trimmedModelId,
      api: "openai-responses" as const,
      provider: SUB2API_OPENAI_PROVIDER_ID,
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: OPENAI_GPT_54_MINI_COST,
      contextWindow: OPENAI_GPT_54_MINI_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
    return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
  }
  if (lower === OPENAI_GPT_54_NANO_MODEL_ID) {
    const model = {
      id: trimmedModelId,
      name: trimmedModelId,
      api: "openai-responses" as const,
      provider: SUB2API_OPENAI_PROVIDER_ID,
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: OPENAI_GPT_54_NANO_COST,
      contextWindow: OPENAI_GPT_54_NANO_CONTEXT_TOKENS,
      maxTokens: OPENAI_GPT_54_MAX_TOKENS,
    };
    return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
  }
  return undefined;
}

function shouldUseSub2ApiOpenAIResponsesTransport(params: {
  provider: string;
  api?: string | null;
}): boolean {
  return (
    normalizeProviderId(params.provider) === SUB2API_OPENAI_PROVIDER_ID &&
    params.api === "openai-completions"
  );
}

function normalizeSub2ApiOpenAITransport(model: ProviderRuntimeModel): ProviderRuntimeModel {
  return shouldUseSub2ApiOpenAIResponsesTransport({
    provider: model.provider,
    api: model.api,
  })
    ? {
        ...model,
        api: "openai-responses",
      }
    : model;
}

function normalizeIdentityValue(value: string, maxLength = 160): string {
  const trimmed = value.trim().replace(/[\r\n]+/g, " ");
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function resolveSessionHeaders(params: {
  provider: string;
  sessionId?: string;
}): Record<string, string> | undefined {
  if (normalizeProviderId(params.provider) !== SUB2API_OPENAI_PROVIDER_ID || !params.sessionId) {
    return undefined;
  }
  const sessionId = normalizeIdentityValue(params.sessionId);
  if (!sessionId) {
    return undefined;
  }
  return {
    "x-client-request-id": sessionId,
    "x-openclaw-session-id": sessionId,
  };
}

function resolveSub2ApiOpenAITransportTurnState(ctx: {
  provider: string;
  sessionId?: string;
  turnId: string;
  attempt: number;
}):
  | {
      headers: Record<string, string>;
    }
  | undefined {
  const sessionHeaders = resolveSessionHeaders({
    provider: ctx.provider,
    sessionId: ctx.sessionId,
  });
  if (!sessionHeaders) {
    return undefined;
  }
  const turnId = normalizeIdentityValue(ctx.turnId);
  const attempt = String(Math.max(1, ctx.attempt));
  return {
    headers: {
      ...sessionHeaders,
      "x-openclaw-turn-id": turnId,
      "x-openclaw-turn-attempt": attempt,
    },
  };
}

function resolveSub2ApiOpenAIWebSocketSessionPolicy(ctx: { provider: string; sessionId?: string }):
  | {
      headers?: Record<string, string>;
      degradeCooldownMs: number;
    }
  | undefined {
  if (normalizeProviderId(ctx.provider) !== SUB2API_OPENAI_PROVIDER_ID) {
    return undefined;
  }
  return {
    headers: resolveSessionHeaders({
      provider: ctx.provider,
      sessionId: ctx.sessionId,
    }),
    degradeCooldownMs: DEFAULT_OPENAI_WS_DEGRADE_COOLDOWN_MS,
  };
}

function buildSub2ApiOpenAIReplayPolicy(ctx: ProviderReplayPolicyContext) {
  if (ctx.modelApi !== "openai-completions" && ctx.modelApi !== "openai-responses") {
    return undefined;
  }
  return {
    sanitizeMode: "images-only" as const,
    applyAssistantFirstOrderingFix: false,
    sanitizeToolCallIds: ctx.modelApi === "openai-completions",
    ...(ctx.modelApi === "openai-completions" ? { toolCallIdMode: "strict" as const } : {}),
    validateGeminiTurns: false,
    validateAnthropicTurns: false,
  };
}

function augmentSub2ApiOpenAICatalogEntries(params: {
  config?: OpenClawConfig;
  entries: Sub2ApiCatalogEntry[];
}) {
  const existingIds = new Set(
    params.entries
      .filter((entry) => entry.provider === SUB2API_OPENAI_PROVIDER_ID)
      .map((entry) => normalizeLowercaseStringOrEmpty(entry.id)),
  );

  return [
    {
      id: OPENAI_GPT_54_MODEL_ID,
      contextWindow: OPENAI_GPT_54_CONTEXT_TOKENS,
    },
    {
      id: OPENAI_GPT_54_PRO_MODEL_ID,
      contextWindow: OPENAI_GPT_54_PRO_CONTEXT_TOKENS,
    },
    {
      id: OPENAI_GPT_54_MINI_MODEL_ID,
      contextWindow: OPENAI_GPT_54_MINI_CONTEXT_TOKENS,
    },
    {
      id: OPENAI_GPT_54_NANO_MODEL_ID,
      contextWindow: OPENAI_GPT_54_NANO_CONTEXT_TOKENS,
    },
  ]
    .filter(({ id }) => !existingIds.has(normalizeLowercaseStringOrEmpty(id)))
    .map(({ id, contextWindow }) => {
      const contextTokens = resolveCodexContextTokens(params.config, id);
      return {
        provider: SUB2API_OPENAI_PROVIDER_ID,
        id,
        name: id,
        reasoning: true,
        input: ["text", "image"] as Array<"text" | "image">,
        contextWindow,
        ...(contextTokens ? { contextTokens } : {}),
      };
    });
}

function buildSub2ApiOpenAIUnknownModelHint(config: OpenClawConfig | undefined): string {
  const hasBaseUrl = Boolean(resolveConfiguredProviderBaseUrl(config, SUB2API_OPENAI_PROVIDER_ID));
  return hasBaseUrl
    ? `Configure models.providers.${SUB2API_OPENAI_PROVIDER_ID}.models or make sure the gateway exposes GET /models.`
    : `Configure models.providers.${SUB2API_OPENAI_PROVIDER_ID}.baseUrl and either expose GET /models or set models.providers.${SUB2API_OPENAI_PROVIDER_ID}.models explicitly.`;
}

function normalizeOpenAIProviderConfig(providerConfig: ModelProviderConfig): ModelProviderConfig {
  if (providerConfig.api === "openai-responses") {
    return providerConfig;
  }
  return {
    ...providerConfig,
    api: "openai-responses",
  };
}

export function buildSub2ApiOpenAIProvider(): ProviderPlugin {
  return {
    id: SUB2API_OPENAI_PROVIDER_ID,
    label: SUB2API_OPENAI_PROVIDER_LABEL,
    docsPath: "/providers/models",
    envVars: [SUB2API_OPENAI_ENV_VAR],
    auth: [
      {
        id: "custom",
        label: "Sub2API OpenAI",
        hint: "OpenAI Responses-compatible gateway",
        kind: "custom",
        wizard: {
          choiceId: "sub2api-openai-api-key",
          choiceLabel: "Sub2API OpenAI API key",
          choiceHint: "OpenAI Responses-compatible gateway",
          groupId: SUB2API_GROUP_ID,
          groupLabel: SUB2API_GROUP_LABEL,
          groupHint: SUB2API_GROUP_HINT,
          methodId: "custom",
        },
        run: async (ctx) =>
          await promptAndConfigureSub2ApiProviderAuth(ctx, {
            providerId: SUB2API_OPENAI_PROVIDER_ID,
            providerLabel: SUB2API_OPENAI_PROVIDER_LABEL,
            defaultBaseUrlPlaceholder: SUB2API_OPENAI_BASE_URL_PLACEHOLDER,
            envVar: SUB2API_OPENAI_ENV_VAR,
            api: "openai-responses",
            defaultModel: {
              ref: SUB2API_OPENAI_DEFAULT_MODEL_REF,
              definition: SUB2API_OPENAI_DEFAULT_MODEL,
            },
            applyConfig: applySub2ApiOpenAIConfig,
          }),
        runNonInteractive: async (ctx) =>
          await configureSub2ApiProviderNonInteractive(ctx, {
            providerId: SUB2API_OPENAI_PROVIDER_ID,
            providerLabel: SUB2API_OPENAI_PROVIDER_LABEL,
            defaultBaseUrlPlaceholder: SUB2API_OPENAI_BASE_URL_PLACEHOLDER,
            envVar: SUB2API_OPENAI_ENV_VAR,
            api: "openai-responses",
            defaultModel: {
              ref: SUB2API_OPENAI_DEFAULT_MODEL_REF,
              definition: SUB2API_OPENAI_DEFAULT_MODEL,
            },
            applyConfig: applySub2ApiOpenAIConfig,
          }),
      },
    ],
    wizard: {
      modelPicker: {
        label: "Sub2API OpenAI",
        hint: "Enter Sub2API OpenAI base URL + API key",
        methodId: "custom",
      },
    },
    catalog: {
      order: "simple",
      run: async (ctx) => {
        const baseUrl = resolveConfiguredProviderBaseUrl(ctx.config, SUB2API_OPENAI_PROVIDER_ID);
        const { apiKey, discoveryApiKey } = ctx.resolveProviderApiKey(SUB2API_OPENAI_PROVIDER_ID);
        if (!apiKey || !baseUrl) {
          return null;
        }
        const configuredModels = readConfiguredProviderModels(
          ctx.config,
          SUB2API_OPENAI_PROVIDER_ID,
          {
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 128_000,
            maxTokens: 128_000,
          },
        );
        const discoveredModels = await discoverSub2ApiOpenAIModels({
          baseUrl,
          apiKey: discoveryApiKey ?? apiKey,
          env: ctx.env,
        });
        return {
          provider: buildProviderConfig({
            baseUrl,
            apiKey,
            api: "openai-responses",
            models: mergeModelCatalogs(discoveredModels, configuredModels),
          }),
        };
      },
    },
    normalizeConfig: ({ providerConfig }) => normalizeOpenAIProviderConfig(providerConfig as never),
    normalizeTransport: ({ provider, api, baseUrl }) =>
      shouldUseSub2ApiOpenAIResponsesTransport({ provider, api })
        ? { api: "openai-responses", baseUrl }
        : undefined,
    normalizeResolvedModel: (ctx) => {
      const normalized = normalizeSub2ApiOpenAITransport(ctx.model);
      const contextTokens = resolveCodexContextTokens(ctx.config, ctx.modelId);
      return contextTokens ? { ...normalized, contextTokens } : normalized;
    },
    resolveDynamicModel: (ctx) => {
      const baseUrl =
        trimConfiguredBaseUrl(ctx.providerConfig?.baseUrl) ??
        resolveConfiguredProviderBaseUrl(ctx.config, SUB2API_OPENAI_PROVIDER_ID);
      const model =
        resolveSub2ApiOpenAIForwardCompatModel({
          modelId: ctx.modelId.trim(),
          baseUrl,
        }) ??
        buildOpenAiDynamicModel({
          providerId: SUB2API_OPENAI_PROVIDER_ID,
          modelId: ctx.modelId.trim(),
          baseUrl,
        });
      return model.id ? model : undefined;
    },
    buildReplayPolicy: (ctx) => buildSub2ApiOpenAIReplayPolicy(ctx),
    prepareExtraParams: (ctx) => {
      const transport = ctx.extraParams?.transport;
      const hasSupportedTransport =
        transport === "auto" || transport === "sse" || transport === "websocket";
      const params = resolveSub2ApiModelParams(ctx.config, ctx.modelId);
      const codexTextVerbosityProfile = params?.codexTextVerbosityProfile;
      const enableCodexCodingDefaults = params?.codexCodingDefaults === true;
      const configuredToolResultModel =
        typeof params?.toolResultModel === "string" ? params.toolResultModel.trim() : "";
      return {
        ...ctx.extraParams,
        ...(hasSupportedTransport ? {} : { transport: "auto" }),
        ...(ctx.extraParams?.toolResultModel === undefined &&
        ctx.extraParams?.tool_result_model === undefined &&
        configuredToolResultModel
          ? { toolResultModel: configuredToolResultModel }
          : {}),
        ...(ctx.extraParams?.textVerbosity === undefined &&
        ctx.extraParams?.text_verbosity === undefined &&
        typeof codexTextVerbosityProfile === "string"
          ? { textVerbosity: codexTextVerbosityProfile }
          : {}),
        ...(enableCodexCodingDefaults &&
        ctx.extraParams?.parallel_tool_calls === undefined &&
        ctx.extraParams?.parallelToolCalls === undefined
          ? { parallel_tool_calls: true }
          : {}),
        ...(enableCodexCodingDefaults &&
        ctx.extraParams?.textVerbosity === undefined &&
        ctx.extraParams?.text_verbosity === undefined &&
        codexTextVerbosityProfile === undefined
          ? { textVerbosity: "low" }
          : {}),
      };
    },
    wrapStreamFn: (ctx) => wrapSub2ApiOpenAIProviderStream(ctx),
    matchesContextOverflowError: ({ errorMessage }) =>
      /content_filter.*(?:prompt|input).*(?:too long|exceed)/i.test(errorMessage),
    resolveTransportTurnState: (ctx) => resolveSub2ApiOpenAITransportTurnState(ctx),
    resolveWebSocketSessionPolicy: (ctx) => resolveSub2ApiOpenAIWebSocketSessionPolicy(ctx),
    resolveReasoningOutputMode: () => "native",
    supportsXHighThinking: ({ modelId }) => supportsSub2ApiOpenAIXHigh(modelId),
    isModernModelRef: ({ modelId }) => isSub2ApiOpenAIModernModel(modelId),
    augmentModelCatalog: (ctx) =>
      augmentSub2ApiOpenAICatalogEntries({ config: ctx.config, entries: ctx.entries }),
    buildUnknownModelHint: ({ config }) => buildSub2ApiOpenAIUnknownModelHint(config),
  };
}

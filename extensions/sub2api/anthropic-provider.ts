import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ProviderRuntimeModel } from "openclaw/plugin-sdk/plugin-entry";
import type {
  ModelProviderConfig,
  ProviderPlugin,
} from "openclaw/plugin-sdk/provider-model-shared";
import { buildNativeAnthropicReplayPolicyForModel } from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { wrapSub2ApiAnthropicProviderStream } from "./anthropic-stream.js";
import {
  SUB2API_ANTHROPIC_BASE_URL_PLACEHOLDER,
  SUB2API_ANTHROPIC_DEFAULT_MODEL,
  SUB2API_ANTHROPIC_DEFAULT_MODEL_REF,
  SUB2API_ANTHROPIC_ENV_VAR,
  SUB2API_ANTHROPIC_PROVIDER_ID,
  SUB2API_ANTHROPIC_PROVIDER_LABEL,
  SUB2API_GROUP_HINT,
  SUB2API_GROUP_ID,
  SUB2API_GROUP_LABEL,
  applySub2ApiAnthropicConfig,
} from "./defaults.js";
import { discoverSub2ApiAnthropicModels } from "./discovery.js";
import {
  configureSub2ApiProviderNonInteractive,
  promptAndConfigureSub2ApiProviderAuth,
} from "./setup.js";
import {
  buildAnthropicDynamicModel,
  buildProviderConfig,
  mergeModelCatalogs,
  readConfiguredProviderModels,
  resolveConfiguredProviderBaseUrl,
  trimConfiguredBaseUrl,
} from "./shared.js";

const ANTHROPIC_MODERN_MODEL_PREFIXES = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

function matchesAnthropicModernModel(modelId: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(modelId);
  return ANTHROPIC_MODERN_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function resolveSub2ApiAnthropicForwardCompatModel(params: { modelId: string; baseUrl?: string }) {
  const trimmedModelId = params.modelId.trim();
  const lower = normalizeLowercaseStringOrEmpty(trimmedModelId);
  if (
    lower.startsWith("claude-opus-4-6") ||
    lower.startsWith("claude-opus-4.6") ||
    lower.startsWith("claude-sonnet-4-6") ||
    lower.startsWith("claude-sonnet-4.6")
  ) {
    const model = {
      id: trimmedModelId,
      name: trimmedModelId,
      api: "anthropic-messages" as const,
      provider: SUB2API_ANTHROPIC_PROVIDER_ID,
      reasoning: true,
      input: ["text", "image"] as Array<"text" | "image">,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 200_000,
      maxTokens: 8_192,
    };
    return params.baseUrl ? { ...model, baseUrl: params.baseUrl } : (model as ProviderRuntimeModel);
  }
  return undefined;
}

function normalizeAnthropicProviderConfig(
  providerConfig: ModelProviderConfig,
): ModelProviderConfig {
  if (providerConfig.api === "anthropic-messages") {
    return providerConfig;
  }
  return {
    ...providerConfig,
    api: "anthropic-messages",
  };
}

function resolveSub2ApiAnthropicPrimaryModelRef(
  value: string | { primary?: string; fallbacks?: string[] } | undefined,
): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  const primary = value?.primary;
  if (typeof primary !== "string") {
    return undefined;
  }
  const trimmed = primary.trim();
  return trimmed || undefined;
}

function applySub2ApiAnthropicConfigDefaults(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
}): OpenClawConfig {
  const hasAuth =
    Boolean(params.env[SUB2API_ANTHROPIC_ENV_VAR]?.trim()) ||
    Object.values(params.config.auth?.profiles ?? {}).some(
      (profile) =>
        profile?.provider === SUB2API_ANTHROPIC_PROVIDER_ID && profile.mode === "api_key",
    );
  const defaults = params.config.agents?.defaults;
  if (!hasAuth || !defaults) {
    return params.config;
  }

  let mutated = false;
  const nextDefaults = { ...defaults };

  if (defaults.contextPruning?.mode === undefined) {
    nextDefaults.contextPruning = {
      ...defaults.contextPruning,
      mode: "cache-ttl",
      ttl: defaults.contextPruning?.ttl ?? "1h",
    };
    mutated = true;
  }

  if (defaults.heartbeat?.every === undefined) {
    nextDefaults.heartbeat = {
      ...defaults.heartbeat,
      every: "30m",
    };
    mutated = true;
  }

  const nextModels = defaults.models ? { ...defaults.models } : {};
  let modelsMutated = false;
  for (const [key, entry] of Object.entries(nextModels)) {
    if (!key.startsWith(`${SUB2API_ANTHROPIC_PROVIDER_ID}/`)) {
      continue;
    }
    const current = entry ?? {};
    const paramsValue = (current as { params?: Record<string, unknown> }).params ?? {};
    if (typeof paramsValue.cacheRetention === "string") {
      continue;
    }
    nextModels[key] = {
      ...(current as Record<string, unknown>),
      params: { ...paramsValue, cacheRetention: "short" },
    };
    modelsMutated = true;
  }

  const primary = resolveSub2ApiAnthropicPrimaryModelRef(defaults.model);
  if (primary?.startsWith(`${SUB2API_ANTHROPIC_PROVIDER_ID}/`)) {
    const entry = nextModels[primary] ?? {};
    const paramsValue = (entry as { params?: Record<string, unknown> }).params ?? {};
    if (typeof paramsValue.cacheRetention !== "string") {
      nextModels[primary] = {
        ...(entry as Record<string, unknown>),
        params: { ...paramsValue, cacheRetention: "short" },
      };
      modelsMutated = true;
    }
  }

  if (!mutated && !modelsMutated) {
    return params.config;
  }

  return {
    ...params.config,
    agents: {
      ...params.config.agents,
      defaults: {
        ...nextDefaults,
        ...(modelsMutated ? { models: nextModels } : {}),
      },
    },
  };
}

function buildSub2ApiAnthropicUnknownModelHint(config: OpenClawConfig | undefined): string {
  const hasBaseUrl = Boolean(
    resolveConfiguredProviderBaseUrl(config, SUB2API_ANTHROPIC_PROVIDER_ID),
  );
  return hasBaseUrl
    ? `Configure models.providers.${SUB2API_ANTHROPIC_PROVIDER_ID}.models or make sure the gateway exposes GET /models.`
    : `Configure models.providers.${SUB2API_ANTHROPIC_PROVIDER_ID}.baseUrl and either expose GET /models or set models.providers.${SUB2API_ANTHROPIC_PROVIDER_ID}.models explicitly.`;
}

export function buildSub2ApiAnthropicProvider(): ProviderPlugin {
  return {
    id: SUB2API_ANTHROPIC_PROVIDER_ID,
    label: SUB2API_ANTHROPIC_PROVIDER_LABEL,
    docsPath: "/providers/models",
    envVars: [SUB2API_ANTHROPIC_ENV_VAR],
    auth: [
      {
        id: "custom",
        label: "Sub2API Anthropic",
        hint: "Anthropic Messages-compatible gateway",
        kind: "custom",
        wizard: {
          choiceId: "sub2api-anthropic-api-key",
          choiceLabel: "Sub2API Anthropic API key",
          choiceHint: "Anthropic Messages-compatible gateway",
          groupId: SUB2API_GROUP_ID,
          groupLabel: SUB2API_GROUP_LABEL,
          groupHint: SUB2API_GROUP_HINT,
          methodId: "custom",
        },
        run: async (ctx) =>
          await promptAndConfigureSub2ApiProviderAuth(ctx, {
            providerId: SUB2API_ANTHROPIC_PROVIDER_ID,
            providerLabel: SUB2API_ANTHROPIC_PROVIDER_LABEL,
            defaultBaseUrlPlaceholder: SUB2API_ANTHROPIC_BASE_URL_PLACEHOLDER,
            envVar: SUB2API_ANTHROPIC_ENV_VAR,
            api: "anthropic-messages",
            defaultModel: {
              ref: SUB2API_ANTHROPIC_DEFAULT_MODEL_REF,
              definition: SUB2API_ANTHROPIC_DEFAULT_MODEL,
            },
            applyConfig: applySub2ApiAnthropicConfig,
          }),
        runNonInteractive: async (ctx) =>
          await configureSub2ApiProviderNonInteractive(ctx, {
            providerId: SUB2API_ANTHROPIC_PROVIDER_ID,
            providerLabel: SUB2API_ANTHROPIC_PROVIDER_LABEL,
            defaultBaseUrlPlaceholder: SUB2API_ANTHROPIC_BASE_URL_PLACEHOLDER,
            envVar: SUB2API_ANTHROPIC_ENV_VAR,
            api: "anthropic-messages",
            defaultModel: {
              ref: SUB2API_ANTHROPIC_DEFAULT_MODEL_REF,
              definition: SUB2API_ANTHROPIC_DEFAULT_MODEL,
            },
            applyConfig: applySub2ApiAnthropicConfig,
          }),
      },
    ],
    wizard: {
      modelPicker: {
        label: "Sub2API Anthropic",
        hint: "Enter Sub2API Anthropic base URL + API key",
        methodId: "custom",
      },
    },
    catalog: {
      order: "simple",
      run: async (ctx) => {
        const baseUrl = resolveConfiguredProviderBaseUrl(ctx.config, SUB2API_ANTHROPIC_PROVIDER_ID);
        const { apiKey, discoveryApiKey } = ctx.resolveProviderApiKey(
          SUB2API_ANTHROPIC_PROVIDER_ID,
        );
        if (!apiKey || !baseUrl) {
          return null;
        }
        const configuredModels = readConfiguredProviderModels(
          ctx.config,
          SUB2API_ANTHROPIC_PROVIDER_ID,
          {
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200_000,
            maxTokens: 8_192,
          },
        );
        const discoveredModels = await discoverSub2ApiAnthropicModels({
          baseUrl,
          apiKey: discoveryApiKey ?? apiKey,
        });
        return {
          provider: buildProviderConfig({
            baseUrl,
            apiKey,
            api: "anthropic-messages",
            models: mergeModelCatalogs(discoveredModels, configuredModels),
          }),
        };
      },
    },
    normalizeConfig: ({ providerConfig }) =>
      normalizeAnthropicProviderConfig(providerConfig as never),
    applyConfigDefaults: ({ config, env }) => applySub2ApiAnthropicConfigDefaults({ config, env }),
    resolveDynamicModel: (ctx) => {
      const baseUrl =
        trimConfiguredBaseUrl(ctx.providerConfig?.baseUrl) ??
        resolveConfiguredProviderBaseUrl(ctx.config, SUB2API_ANTHROPIC_PROVIDER_ID);
      const model =
        resolveSub2ApiAnthropicForwardCompatModel({
          modelId: ctx.modelId.trim(),
          baseUrl,
        }) ??
        buildAnthropicDynamicModel({
          providerId: SUB2API_ANTHROPIC_PROVIDER_ID,
          modelId: ctx.modelId.trim(),
          baseUrl,
        });
      return model.id ? model : undefined;
    },
    buildReplayPolicy: ({ modelId }) => buildNativeAnthropicReplayPolicyForModel(modelId),
    wrapStreamFn: wrapSub2ApiAnthropicProviderStream,
    resolveReasoningOutputMode: () => "native",
    resolveDefaultThinkingLevel: ({ modelId }) =>
      matchesAnthropicModernModel(modelId) ? "adaptive" : undefined,
    isModernModelRef: ({ modelId }) => matchesAnthropicModernModel(modelId),
    isCacheTtlEligible: () => true,
    buildUnknownModelHint: ({ config }) => buildSub2ApiAnthropicUnknownModelHint(config),
  };
}

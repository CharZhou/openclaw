import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import {
  normalizeProviderId,
  type ProviderPlugin,
} from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { applyOpenAIConfig, OPENAI_DEFAULT_MODEL } from "./default-models.js";
import {
  augmentOpenAIGpt54CatalogEntries,
  buildOpenAIResponsesExtraParams,
  isOpenAIModernModelRef,
  normalizeOpenAIResponsesTransport,
  OPENAI_RESPONSES_STREAM_HOOKS,
  resolveOpenAIGpt54ForwardCompatModel,
  shouldUseOpenAIResponsesTransport,
  supportsOpenAIXHighThinking,
} from "./provider-family.js";
import { buildOpenAIReplayPolicy } from "./replay-policy.js";
import {
  resolveOpenAITransportTurnState,
  resolveOpenAIWebSocketSessionPolicy,
} from "./transport-policy.js";

const PROVIDER_ID = "openai";
const OPENAI_DIRECT_SPARK_MODEL_ID = "gpt-5.3-codex-spark";
const SUPPRESSED_SPARK_PROVIDERS = new Set(["openai", "azure-openai-responses"]);

export function buildOpenAIProvider(): ProviderPlugin {
  return {
    id: PROVIDER_ID,
    label: "OpenAI",
    hookAliases: ["azure-openai", "azure-openai-responses"],
    docsPath: "/providers/models",
    envVars: ["OPENAI_API_KEY"],
    auth: [
      createProviderApiKeyAuthMethod({
        providerId: PROVIDER_ID,
        methodId: "api-key",
        label: "OpenAI API key",
        hint: "Direct OpenAI API key",
        optionKey: "openaiApiKey",
        flagName: "--openai-api-key",
        envVar: "OPENAI_API_KEY",
        promptMessage: "Enter OpenAI API key",
        defaultModel: OPENAI_DEFAULT_MODEL,
        expectedProviders: ["openai"],
        applyConfig: (cfg) => applyOpenAIConfig(cfg),
        wizard: {
          choiceId: "openai-api-key",
          choiceLabel: "OpenAI API key",
          groupId: "openai",
          groupLabel: "OpenAI",
          groupHint: "Codex OAuth + API key",
        },
      }),
    ],
    resolveDynamicModel: (ctx) => resolveOpenAIGpt54ForwardCompatModel(ctx),
    normalizeResolvedModel: (ctx) => {
      if (normalizeProviderId(ctx.provider) !== PROVIDER_ID) {
        return undefined;
      }
      return normalizeOpenAIResponsesTransport(ctx.model);
    },
    normalizeTransport: ({ provider, api, baseUrl }) =>
      shouldUseOpenAIResponsesTransport({ provider, api, baseUrl })
        ? { api: "openai-responses", baseUrl }
        : undefined,
    buildReplayPolicy: buildOpenAIReplayPolicy,
    prepareExtraParams: (ctx) => buildOpenAIResponsesExtraParams(ctx),
    ...OPENAI_RESPONSES_STREAM_HOOKS,
    matchesContextOverflowError: ({ errorMessage }) =>
      /content_filter.*(?:prompt|input).*(?:too long|exceed)/i.test(errorMessage),
    resolveTransportTurnState: (ctx) => resolveOpenAITransportTurnState(ctx),
    resolveWebSocketSessionPolicy: (ctx) => resolveOpenAIWebSocketSessionPolicy(ctx),
    resolveReasoningOutputMode: () => "native",
    supportsXHighThinking: ({ modelId }) => supportsOpenAIXHighThinking(modelId),
    isModernModelRef: ({ modelId }) => isOpenAIModernModelRef(modelId),
    buildMissingAuthMessage: (ctx) => {
      if (ctx.provider !== PROVIDER_ID || ctx.listProfileIds("openai-codex").length === 0) {
        return undefined;
      }
      return 'No API key found for provider "openai". You are authenticated with OpenAI Codex OAuth. Use openai-codex/gpt-5.4 (OAuth) or set OPENAI_API_KEY to use openai/gpt-5.4.';
    },
    suppressBuiltInModel: (ctx) => {
      if (
        !SUPPRESSED_SPARK_PROVIDERS.has(normalizeProviderId(ctx.provider)) ||
        normalizeLowercaseStringOrEmpty(ctx.modelId) !== OPENAI_DIRECT_SPARK_MODEL_ID
      ) {
        return undefined;
      }
      return {
        suppress: true,
        errorMessage: `Unknown model: ${ctx.provider}/${OPENAI_DIRECT_SPARK_MODEL_ID}. ${OPENAI_DIRECT_SPARK_MODEL_ID} is only supported via openai-codex OAuth. Use openai-codex/${OPENAI_DIRECT_SPARK_MODEL_ID}.`,
      };
    },
    augmentModelCatalog: (ctx) => {
      return augmentOpenAIGpt54CatalogEntries({ entries: ctx.entries });
    },
  };
}

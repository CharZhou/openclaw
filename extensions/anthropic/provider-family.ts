import type {
  ProviderReasoningOutputModeContext,
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  cloneFirstTemplateModel,
  type ProviderPlugin,
} from "openclaw/plugin-sdk/provider-model-shared";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { CLAUDE_CLI_BACKEND_ID } from "./cli-shared.js";
import {
  applyAnthropicConfigDefaults,
  normalizeAnthropicProviderConfig,
} from "./config-defaults.js";
import { buildAnthropicReplayPolicy } from "./replay-policy.js";
import { wrapAnthropicProviderStream } from "./stream-wrappers.js";

const ANTHROPIC_OPUS_46_MODEL_ID = "claude-opus-4-6";
const ANTHROPIC_OPUS_46_DOT_MODEL_ID = "claude-opus-4.6";
const ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS = ["claude-opus-4-5", "claude-opus-4.5"] as const;
const ANTHROPIC_SONNET_46_MODEL_ID = "claude-sonnet-4-6";
const ANTHROPIC_SONNET_46_DOT_MODEL_ID = "claude-sonnet-4.6";
const ANTHROPIC_SONNET_TEMPLATE_MODEL_IDS = ["claude-sonnet-4-5", "claude-sonnet-4.5"] as const;
const ANTHROPIC_MODERN_MODEL_PREFIXES = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
] as const;

type AnthropicMessagesFamilyHooks = Pick<
  ProviderPlugin,
  | "normalizeConfig"
  | "applyConfigDefaults"
  | "resolveDynamicModel"
  | "buildReplayPolicy"
  | "wrapStreamFn"
  | "isModernModelRef"
  | "resolveReasoningOutputMode"
  | "resolveDefaultThinkingLevel"
  | "isCacheTtlEligible"
>;

function resolveAnthropic46ForwardCompatModel(params: {
  ctx: ProviderResolveDynamicModelContext;
  dashModelId: string;
  dotModelId: string;
  dashTemplateId: string;
  dotTemplateId: string;
  fallbackTemplateIds: readonly string[];
}): ProviderRuntimeModel | undefined {
  const trimmedModelId = params.ctx.modelId.trim();
  const lower = normalizeLowercaseStringOrEmpty(trimmedModelId);
  const is46Model =
    lower === params.dashModelId ||
    lower === params.dotModelId ||
    lower.startsWith(`${params.dashModelId}-`) ||
    lower.startsWith(`${params.dotModelId}-`);
  if (!is46Model) {
    return undefined;
  }

  const templateIds: string[] = [];
  if (lower.startsWith(params.dashModelId)) {
    templateIds.push(lower.replace(params.dashModelId, params.dashTemplateId));
  }
  if (lower.startsWith(params.dotModelId)) {
    templateIds.push(lower.replace(params.dotModelId, params.dotTemplateId));
  }
  templateIds.push(...params.fallbackTemplateIds);

  return cloneFirstTemplateModel({
    providerId: "anthropic",
    modelId: trimmedModelId,
    templateIds,
    ctx: params.ctx,
    patch:
      normalizeLowercaseStringOrEmpty(params.ctx.provider) === CLAUDE_CLI_BACKEND_ID
        ? { provider: CLAUDE_CLI_BACKEND_ID }
        : undefined,
  });
}

export function resolveAnthropicForwardCompatModel(
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  return (
    resolveAnthropic46ForwardCompatModel({
      ctx,
      dashModelId: ANTHROPIC_OPUS_46_MODEL_ID,
      dotModelId: ANTHROPIC_OPUS_46_DOT_MODEL_ID,
      dashTemplateId: "claude-opus-4-5",
      dotTemplateId: "claude-opus-4.5",
      fallbackTemplateIds: ANTHROPIC_OPUS_TEMPLATE_MODEL_IDS,
    }) ??
    resolveAnthropic46ForwardCompatModel({
      ctx,
      dashModelId: ANTHROPIC_SONNET_46_MODEL_ID,
      dotModelId: ANTHROPIC_SONNET_46_DOT_MODEL_ID,
      dashTemplateId: "claude-sonnet-4-5",
      dotTemplateId: "claude-sonnet-4.5",
      fallbackTemplateIds: ANTHROPIC_SONNET_TEMPLATE_MODEL_IDS,
    })
  );
}

export function shouldUseAnthropicAdaptiveThinkingDefault(modelId: string): boolean {
  const lowerModelId = normalizeLowercaseStringOrEmpty(modelId);
  return (
    lowerModelId.startsWith(ANTHROPIC_OPUS_46_MODEL_ID) ||
    lowerModelId.startsWith(ANTHROPIC_OPUS_46_DOT_MODEL_ID) ||
    lowerModelId.startsWith(ANTHROPIC_SONNET_46_MODEL_ID) ||
    lowerModelId.startsWith(ANTHROPIC_SONNET_46_DOT_MODEL_ID)
  );
}

export function matchesAnthropicModernModel(modelId: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(modelId);
  return ANTHROPIC_MODERN_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function resolveAnthropicFamilyReasoningOutputMode(
  _ctx: ProviderReasoningOutputModeContext,
) {
  return "native" as const;
}

export function buildAnthropicMessagesFamilyHooks(): AnthropicMessagesFamilyHooks {
  return {
    normalizeConfig: ({ providerConfig }) => normalizeAnthropicProviderConfig(providerConfig),
    applyConfigDefaults: ({ config, env }) => applyAnthropicConfigDefaults({ config, env }),
    resolveDynamicModel: (ctx) => resolveAnthropicForwardCompatModel(ctx),
    buildReplayPolicy: buildAnthropicReplayPolicy,
    wrapStreamFn: wrapAnthropicProviderStream,
    isModernModelRef: ({ modelId }) => matchesAnthropicModernModel(modelId),
    resolveReasoningOutputMode: (ctx) => resolveAnthropicFamilyReasoningOutputMode(ctx),
    resolveDefaultThinkingLevel: ({ modelId }) =>
      matchesAnthropicModernModel(modelId) && shouldUseAnthropicAdaptiveThinkingDefault(modelId)
        ? "adaptive"
        : undefined,
    isCacheTtlEligible: () => true,
  };
}

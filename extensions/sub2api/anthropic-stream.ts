import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  applyAnthropicPayloadPolicyToParams,
  composeProviderStreamWrappers,
  resolveAnthropicPayloadPolicy,
  streamWithPayloadPatch,
} from "openclaw/plugin-sdk/provider-stream";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { normalizeLowercaseStringOrEmpty, readStringValue } from "openclaw/plugin-sdk/text-runtime";
import { buildSub2ApiToolResultRouteModel, parseSub2ApiToolResultModelRef } from "./shared.js";

const log = createSubsystemLogger("sub2api/anthropic-stream");

const ANTHROPIC_CONTEXT_1M_BETA = "context-1m-2025-08-07";
const ANTHROPIC_1M_MODEL_PREFIXES = ["claude-opus-4", "claude-sonnet-4"] as const;
const PI_AI_DEFAULT_ANTHROPIC_BETAS = [
  "fine-grained-tool-streaming-2025-05-14",
  "interleaved-thinking-2025-05-14",
] as const;

type AnthropicServiceTier = "auto" | "standard_only";

function isAnthropic1MModel(modelId: string): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  return ANTHROPIC_1M_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseHeaderList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeAnthropicBetaHeader(
  headers: Record<string, string> | undefined,
  betas: string[],
): Record<string, string> {
  const merged = { ...headers };
  const existingKey = Object.keys(merged).find(
    (key) => normalizeLowercaseStringOrEmpty(key) === "anthropic-beta",
  );
  const existing = existingKey ? parseHeaderList(merged[existingKey]) : [];
  const values = Array.from(new Set([...existing, ...betas]));
  const key = existingKey ?? "anthropic-beta";
  merged[key] = values.join(",");
  return merged;
}

function resolveAnthropicFastServiceTier(enabled: boolean): AnthropicServiceTier {
  return enabled ? "auto" : "standard_only";
}

function normalizeFastMode(raw?: string | boolean | null): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (!raw) {
    return undefined;
  }
  const key = normalizeLowercaseStringOrEmpty(raw);
  if (["off", "false", "no", "0", "disable", "disabled", "normal"].includes(key)) {
    return false;
  }
  if (["on", "true", "yes", "1", "enable", "enabled", "fast"].includes(key)) {
    return true;
  }
  return undefined;
}

function normalizeAnthropicServiceTier(value: unknown): AnthropicServiceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeLowercaseStringOrEmpty(value);
  if (normalized === "auto" || normalized === "standard_only") {
    return normalized;
  }
  return undefined;
}

export function resolveSub2ApiAnthropicBetas(
  extraParams: Record<string, unknown> | undefined,
  modelId: string,
): string[] | undefined {
  const betas = new Set<string>();
  const configured = extraParams?.anthropicBeta;
  if (typeof configured === "string" && configured.trim()) {
    betas.add(configured.trim());
  } else if (Array.isArray(configured)) {
    for (const beta of configured) {
      if (typeof beta === "string" && beta.trim()) {
        betas.add(beta.trim());
      }
    }
  }

  if (extraParams?.context1m === true) {
    if (isAnthropic1MModel(modelId)) {
      betas.add(ANTHROPIC_CONTEXT_1M_BETA);
    } else {
      log.warn(`ignoring context1m for non-opus/sonnet model: ${modelId}`);
    }
  }

  return betas.size > 0 ? [...betas] : undefined;
}

function createAnthropicBetaHeadersWrapper(
  baseStreamFn: StreamFn | undefined,
  betas: string[],
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    underlying(model, context, {
      ...options,
      headers: mergeAnthropicBetaHeader(options?.headers, [
        ...PI_AI_DEFAULT_ANTHROPIC_BETAS,
        ...betas,
      ]),
    });
}

function createAnthropicFastModeWrapper(
  baseStreamFn: StreamFn | undefined,
  enabled: boolean,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  const serviceTier = resolveAnthropicFastServiceTier(enabled);
  return (model, context, options) => {
    const payloadPolicy = resolveAnthropicPayloadPolicy({
      provider: readStringValue(model.provider),
      api: readStringValue(model.api),
      baseUrl: readStringValue(model.baseUrl),
      serviceTier,
    });
    if (!payloadPolicy.allowsServiceTier) {
      return underlying(model, context, options);
    }
    return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) =>
      applyAnthropicPayloadPolicyToParams(payloadObj, payloadPolicy),
    );
  };
}

function createAnthropicServiceTierWrapper(
  baseStreamFn: StreamFn | undefined,
  serviceTier: AnthropicServiceTier,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const payloadPolicy = resolveAnthropicPayloadPolicy({
      provider: readStringValue(model.provider),
      api: readStringValue(model.api),
      baseUrl: readStringValue(model.baseUrl),
      serviceTier,
    });
    if (!payloadPolicy.allowsServiceTier) {
      return underlying(model, context, options);
    }
    return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) =>
      applyAnthropicPayloadPolicyToParams(payloadObj, payloadPolicy),
    );
  };
}

function resolveAnthropicFastMode(
  extraParams: Record<string, unknown> | undefined,
): boolean | undefined {
  return normalizeFastMode(
    (extraParams?.fastMode ?? extraParams?.fast_mode) as string | boolean | null | undefined,
  );
}

function resolveAnthropicServiceTier(
  extraParams: Record<string, unknown> | undefined,
): AnthropicServiceTier | undefined {
  const raw = extraParams?.serviceTier ?? extraParams?.service_tier;
  const normalized = normalizeAnthropicServiceTier(raw);
  if (raw !== undefined && normalized === undefined) {
    const rawSummary = typeof raw === "string" ? raw : typeof raw;
    log.warn(`ignoring invalid Anthropic service tier param: ${rawSummary}`);
  }
  return normalized;
}

function shouldRouteToolResultFollowup(messages: unknown): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  const lastMessage = messages.at(-1);
  return (
    Boolean(lastMessage) &&
    typeof lastMessage === "object" &&
    (lastMessage as { role?: unknown }).role === "toolResult"
  );
}

function createSub2ApiToolResultModelWrapper(
  baseStreamFn: StreamFn | undefined,
  ctx: ProviderWrapStreamFnContext,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  const rawToolResultModel = ctx.extraParams?.toolResultModel ?? ctx.extraParams?.tool_result_model;
  return (model, context, options) => {
    const routeResolved = ctx.extraParams?.__sub2apiRouteResolved === true;
    const target = routeResolved
      ? undefined
      : parseSub2ApiToolResultModelRef({
          value: rawToolResultModel,
          currentProviderId: ctx.provider,
        });
    if (
      !target ||
      (target.providerId === model.provider && target.modelId === model.id) ||
      !shouldRouteToolResultFollowup(context.messages)
    ) {
      return underlying(model, context, options);
    }
    if (target.providerId === ctx.provider) {
      return underlying(
        {
          ...model,
          id: target.modelId,
          name: target.modelId,
        },
        context,
        options,
      );
    }
    return (async () => {
      const targetModel = buildSub2ApiToolResultRouteModel({
        config: ctx.config,
        target,
      });
      const targetStreamBase = ctx.createStreamFnForModel?.(targetModel);
      if (!targetStreamBase) {
        return underlying(model, context, options);
      }
      const targetApiKey = await ctx.resolveProviderApiKey?.(target.providerId);
      const { wrapSub2ApiOpenAIProviderStream } = await import("./openai-stream.js");
      const targetStream =
        wrapSub2ApiOpenAIProviderStream({
          ...ctx,
          provider: target.providerId,
          modelId: target.modelId,
          model: targetModel,
          streamFn: targetStreamBase,
          extraParams: {
            ...ctx.extraParams,
            __sub2apiRouteResolved: true,
          },
        }) ?? targetStreamBase;
      return targetStream(targetModel, context, {
        ...options,
        ...(targetApiKey ? { apiKey: targetApiKey } : {}),
      });
    })() as ReturnType<StreamFn>;
  };
}

export function wrapSub2ApiAnthropicProviderStream(
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  const anthropicBetas = resolveSub2ApiAnthropicBetas(ctx.extraParams, ctx.modelId);
  const serviceTier = resolveAnthropicServiceTier(ctx.extraParams);
  const fastMode = resolveAnthropicFastMode(ctx.extraParams);
  return composeProviderStreamWrappers(
    ctx.streamFn,
    anthropicBetas?.length
      ? (streamFn) => createAnthropicBetaHeadersWrapper(streamFn, anthropicBetas)
      : undefined,
    serviceTier
      ? (streamFn) => createAnthropicServiceTierWrapper(streamFn, serviceTier)
      : undefined,
    fastMode !== undefined
      ? (streamFn) => createAnthropicFastModeWrapper(streamFn, fastMode)
      : undefined,
    (streamFn) => createSub2ApiToolResultModelWrapper(streamFn, ctx),
  );
}

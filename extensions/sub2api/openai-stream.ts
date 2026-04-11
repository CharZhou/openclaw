import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  composeProviderStreamWrappers,
  createOpenAITextVerbosityWrapper,
  resolveOpenAIFastMode,
  resolveOpenAIServiceTier,
  resolveOpenAITextVerbosity,
  streamWithPayloadPatch,
} from "openclaw/plugin-sdk/provider-stream";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "openclaw/plugin-sdk/text-runtime";
import { buildSub2ApiToolResultRouteModel, parseSub2ApiToolResultModelRef } from "./shared.js";

type OpenAICacheRetention = "none" | "short" | "long";
type OpenAITextVerbosity = "low" | "medium" | "high";

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

function resolveSub2ApiOpenAICacheRetention(
  extraParams: Record<string, unknown> | undefined,
): OpenAICacheRetention | undefined {
  const cacheRetention = extraParams?.cacheRetention;
  if (cacheRetention === "none" || cacheRetention === "short" || cacheRetention === "long") {
    return cacheRetention;
  }
  const legacy = extraParams?.cacheControlTtl;
  if (legacy === "5m") {
    return "short";
  }
  if (legacy === "1h") {
    return "long";
  }
  return undefined;
}

function resolveSub2ApiCodexTextVerbosityProfile(
  extraParams: Record<string, unknown> | undefined,
): OpenAITextVerbosity | undefined {
  const raw = extraParams?.codexTextVerbosityProfile;
  const normalized = normalizeOptionalLowercaseString(raw);
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return undefined;
}

function resolveResponsesCompactThreshold(
  extraParams: Record<string, unknown> | undefined,
  modelContextWindow: unknown,
): number {
  const explicit = extraParams?.responsesCompactThreshold;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  if (typeof explicit === "string") {
    const parsed = Number.parseInt(explicit, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const contextWindow =
    typeof modelContextWindow === "number" &&
    Number.isFinite(modelContextWindow) &&
    modelContextWindow > 0
      ? modelContextWindow
      : 80_000;
  return Math.max(1_000, Math.floor(contextWindow * 0.7));
}

function createSub2ApiOpenAICacheRetentionWrapper(
  baseStreamFn: StreamFn | undefined,
  cacheRetention: OpenAICacheRetention,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const nextOptions = {
      ...options,
      cacheRetention,
    } as Parameters<StreamFn>[2];
    return underlying(model, context, nextOptions);
  };
}

function createSub2ApiOpenAIServiceTierWrapper(
  baseStreamFn: StreamFn | undefined,
  serviceTier: string,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      if (payloadObj.service_tier === undefined) {
        payloadObj.service_tier = serviceTier;
      }
    });
}

function createSub2ApiOpenAIResponsesContextManagementWrapper(
  baseStreamFn: StreamFn | undefined,
  params: {
    compactThreshold: number;
    enableServerCompaction: boolean;
    cacheRetention?: OpenAICacheRetention;
  },
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      if (params.cacheRetention === "long" && payloadObj.prompt_cache_retention === undefined) {
        payloadObj.prompt_cache_retention = "24h";
      }
      if (!params.enableServerCompaction) {
        return;
      }
      payloadObj.store = true;
      if (payloadObj.context_management === undefined) {
        payloadObj.context_management = [
          {
            type: "compaction",
            compact_threshold: params.compactThreshold,
          },
        ];
      }
    });
}

function buildSub2ApiCodexNativeWebSearchTool(config: ProviderWrapStreamFnContext["config"]) {
  const nativeConfig = config?.tools?.web?.search?.openaiCodex;
  const tool: Record<string, unknown> = {
    type: "web_search",
    external_web_access: nativeConfig?.mode === "live",
  };

  if (Array.isArray(nativeConfig?.allowedDomains) && nativeConfig.allowedDomains.length > 0) {
    tool.filters = {
      allowed_domains: nativeConfig.allowedDomains,
    };
  }

  if (
    nativeConfig?.contextSize === "low" ||
    nativeConfig?.contextSize === "medium" ||
    nativeConfig?.contextSize === "high"
  ) {
    tool.search_context_size = nativeConfig.contextSize;
  }

  if (nativeConfig?.userLocation && typeof nativeConfig.userLocation === "object") {
    tool.user_location = {
      type: "approximate",
      ...nativeConfig.userLocation,
    };
  }

  return tool;
}

function createSub2ApiCodexNativeWebSearchWrapper(
  baseStreamFn: StreamFn | undefined,
  ctx: ProviderWrapStreamFnContext,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      const tools = Array.isArray(payloadObj.tools) ? [...payloadObj.tools] : [];
      const alreadyPresent = tools.some(
        (tool) =>
          tool &&
          typeof tool === "object" &&
          (tool as Record<string, unknown>).type === "web_search",
      );
      if (alreadyPresent) {
        return;
      }
      tools.push(buildSub2ApiCodexNativeWebSearchTool(ctx.config));
      payloadObj.tools = tools;
    });
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
      const { wrapSub2ApiAnthropicProviderStream } = await import("./anthropic-stream.js");
      const targetStream =
        wrapSub2ApiAnthropicProviderStream({
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

export function wrapSub2ApiOpenAIProviderStream(
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  const textVerbosity =
    resolveOpenAITextVerbosity(ctx.extraParams) ??
    resolveSub2ApiCodexTextVerbosityProfile(ctx.extraParams);
  const explicitServiceTier = resolveOpenAIServiceTier(ctx.extraParams);
  const fastMode = resolveOpenAIFastMode(ctx.extraParams);
  const serviceTier = explicitServiceTier ?? (fastMode === true ? "priority" : undefined);
  const cacheRetention = resolveSub2ApiOpenAICacheRetention(ctx.extraParams);
  const enableServerCompaction = ctx.extraParams?.responsesServerCompaction === true;
  const enableCodexNativeWebSearch = ctx.extraParams?.codexNativeWebSearch === true;
  const compactThreshold = resolveResponsesCompactThreshold(
    ctx.extraParams,
    ctx.model?.contextWindow,
  );

  return composeProviderStreamWrappers(
    ctx.streamFn,
    cacheRetention
      ? (streamFn) => createSub2ApiOpenAICacheRetentionWrapper(streamFn, cacheRetention)
      : undefined,
    textVerbosity
      ? (streamFn) => createOpenAITextVerbosityWrapper(streamFn, textVerbosity)
      : undefined,
    serviceTier
      ? (streamFn) => createSub2ApiOpenAIServiceTierWrapper(streamFn, serviceTier)
      : undefined,
    enableCodexNativeWebSearch
      ? (streamFn) => createSub2ApiCodexNativeWebSearchWrapper(streamFn, ctx)
      : undefined,
    cacheRetention || enableServerCompaction
      ? (streamFn) =>
          createSub2ApiOpenAIResponsesContextManagementWrapper(streamFn, {
            compactThreshold,
            enableServerCompaction,
            cacheRetention,
          })
      : undefined,
    (streamFn) => createSub2ApiToolResultModelWrapper(streamFn, ctx),
  );
}

export function supportsSub2ApiOpenAIXHigh(modelId: string): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  return (
    normalized === "gpt-5.4" ||
    normalized === "gpt-5.4-pro" ||
    normalized === "gpt-5.4-mini" ||
    normalized === "gpt-5.4-nano" ||
    normalized === "gpt-5.2"
  );
}

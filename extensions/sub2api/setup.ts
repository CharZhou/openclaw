import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type {
  ProviderAuthContext,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
} from "openclaw/plugin-sdk/plugin-entry";
import {
  applyAuthProfileConfig,
  buildApiKeyCredential,
  coerceSecretRef,
  ensureApiKeyFromOptionEnvOrPrompt,
  normalizeApiKeyInput,
  normalizeOptionalSecretInput,
  upsertAuthProfile,
  validateApiKeyInput,
} from "openclaw/plugin-sdk/provider-auth";
import type { SecretInput } from "openclaw/plugin-sdk/provider-auth";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import { trimConfiguredBaseUrl } from "./shared.js";

type SecretInputMode = "plaintext" | "ref";

type Sub2ApiProviderSetupParams = {
  providerId: string;
  providerLabel: string;
  defaultBaseUrl?: string;
  defaultBaseUrlPlaceholder: string;
  defaultModel: {
    ref: string;
    definition: ModelDefinitionConfig;
  };
  envVar: string;
  api: NonNullable<ModelProviderConfig["api"]>;
  applyConfig: (cfg: OpenClawConfig) => OpenClawConfig;
};

function buildSub2ApiProviderConfigPatch(params: {
  cfg: OpenClawConfig;
  providerId: string;
  baseUrl: string;
  api: NonNullable<ModelProviderConfig["api"]>;
  defaultModel: ModelDefinitionConfig;
}): OpenClawConfig {
  const existing = params.cfg.models?.providers?.[params.providerId];
  const existingModels = Array.isArray(existing?.models) ? existing.models : [];
  return {
    ...params.cfg,
    models: {
      ...params.cfg.models,
      mode: params.cfg.models?.mode ?? "merge",
      providers: {
        ...params.cfg.models?.providers,
        [params.providerId]: {
          ...existing,
          baseUrl: params.baseUrl,
          api: params.api,
          models: existingModels.length > 0 ? existingModels : [params.defaultModel],
        },
      },
    },
  };
}

function resolveInitialBaseUrl(params: {
  cfg: OpenClawConfig;
  providerId: string;
  opts?: Record<string, unknown>;
  fallback?: string;
}): string | undefined {
  const optBaseUrl = normalizeOptionalSecretInput(params.opts?.customBaseUrl);
  if (optBaseUrl) {
    return optBaseUrl;
  }
  const configured = trimConfiguredBaseUrl(
    params.cfg.models?.providers?.[params.providerId]?.baseUrl,
  );
  if (configured) {
    return configured;
  }
  return params.fallback;
}

function normalizeConfiguredBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function resolveProfileId(providerId: string): string {
  return `${providerId}:default`;
}

type CapturedCredential = {
  secretInput?: SecretInput;
  mode?: SecretInputMode;
};

function resolveTokenProvider(params: {
  providerId: string;
  opts?: Record<string, unknown>;
}): string | undefined {
  const customApiKey = normalizeOptionalSecretInput(params.opts?.customApiKey);
  if (customApiKey) {
    return params.providerId;
  }
  return normalizeOptionalSecretInput(params.opts?.tokenProvider);
}

function resolveTokenValue(opts?: Record<string, unknown>): string | undefined {
  return (
    normalizeOptionalSecretInput(opts?.customApiKey) ?? normalizeOptionalSecretInput(opts?.token)
  );
}

export async function promptAndConfigureSub2ApiProviderAuth(
  ctx: ProviderAuthContext,
  params: Sub2ApiProviderSetupParams,
): Promise<ProviderAuthResult> {
  const opts = (ctx.opts ?? {}) as Record<string, unknown>;
  const initialBaseUrl = resolveInitialBaseUrl({
    cfg: ctx.config,
    providerId: params.providerId,
    opts,
    fallback: params.defaultBaseUrl,
  });
  const baseUrlRaw = await ctx.prompter.text({
    message: `${params.providerLabel} base URL`,
    ...(initialBaseUrl ? { initialValue: initialBaseUrl } : {}),
    placeholder: params.defaultBaseUrlPlaceholder,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });
  const baseUrl = normalizeConfiguredBaseUrl(baseUrlRaw ?? initialBaseUrl);
  if (!baseUrl) {
    throw new Error(`${params.providerLabel} base URL is required.`);
  }

  const captured: CapturedCredential = {};
  await ensureApiKeyFromOptionEnvOrPrompt({
    token: resolveTokenValue(opts),
    tokenProvider: resolveTokenProvider({ providerId: params.providerId, opts }),
    secretInputMode:
      ctx.allowSecretRefPrompt === false
        ? (ctx.secretInputMode ?? "plaintext")
        : ctx.secretInputMode,
    config: ctx.config,
    env: ctx.env,
    expectedProviders: [params.providerId],
    provider: params.providerId,
    envLabel: params.envVar,
    promptMessage: `${params.providerLabel} API key`,
    normalize: normalizeApiKeyInput,
    validate: validateApiKeyInput,
    prompter: ctx.prompter,
    setCredential: async (secretInput, mode) => {
      const ref = coerceSecretRef(secretInput);
      captured.secretInput = ref ?? secretInput;
      captured.mode = mode;
    },
  });

  if (!captured.secretInput) {
    throw new Error(`Missing API key input for provider "${params.providerId}".`);
  }

  const profileId = resolveProfileId(params.providerId);
  const next = params.applyConfig(
    buildSub2ApiProviderConfigPatch({
      cfg: ctx.config,
      providerId: params.providerId,
      baseUrl,
      api: params.api,
      defaultModel: params.defaultModel.definition,
    }),
  );

  return {
    profiles: [
      {
        profileId,
        credential: buildApiKeyCredential(
          params.providerId,
          captured.secretInput,
          undefined,
          captured.mode ? { secretInputMode: captured.mode } : undefined,
        ),
      },
    ],
    configPatch: next,
    defaultModel: params.defaultModel.ref,
  };
}

export async function configureSub2ApiProviderNonInteractive(
  ctx: ProviderAuthMethodNonInteractiveContext,
  params: Sub2ApiProviderSetupParams,
): Promise<OpenClawConfig | null> {
  const baseUrl = normalizeConfiguredBaseUrl(
    resolveInitialBaseUrl({
      cfg: ctx.config,
      providerId: params.providerId,
      opts: ctx.opts as Record<string, unknown>,
      fallback: params.defaultBaseUrl,
    }),
  );
  if (!baseUrl) {
    ctx.runtime.error(
      `Missing --custom-base-url for ${params.providerLabel}. Set models.providers.${params.providerId}.baseUrl or pass --custom-base-url.`,
    );
    ctx.runtime.exit(1);
    return null;
  }

  const resolved = await ctx.resolveApiKey({
    provider: params.providerId,
    flagValue: resolveTokenValue(ctx.opts as Record<string, unknown>),
    flagName: "--custom-api-key",
    envVar: params.envVar,
    envVarName: params.envVar,
  });
  if (!resolved) {
    return null;
  }

  const credential = ctx.toApiKeyCredential({
    provider: params.providerId,
    resolved,
  });
  if (!credential) {
    return null;
  }

  const profileId = resolveProfileId(params.providerId);
  upsertAuthProfile({
    profileId,
    credential,
    agentDir: ctx.agentDir,
  });

  const next = params.applyConfig(
    buildSub2ApiProviderConfigPatch({
      cfg: ctx.config,
      providerId: params.providerId,
      baseUrl,
      api: params.api,
      defaultModel: params.defaultModel.definition,
    }),
  );

  return applyAuthProfileConfig(next, {
    profileId,
    provider: params.providerId,
    mode: "api_key",
  });
}

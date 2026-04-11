import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  applyAgentDefaultModelPrimary,
  ensureModelAllowlistEntry,
} from "openclaw/plugin-sdk/provider-onboard";

export const SUB2API_PLUGIN_ID = "sub2api";
export const SUB2API_GROUP_ID = "sub2api";
export const SUB2API_GROUP_LABEL = "Sub2API";
export const SUB2API_GROUP_HINT = "OpenAI Responses + Anthropic Messages API keys";

export const SUB2API_OPENAI_PROVIDER_ID = "sub2api-openai";
export const SUB2API_OPENAI_PROVIDER_LABEL = "Sub2API OpenAI";
export const SUB2API_OPENAI_ENV_VAR = "SUB2API_OPENAI_API_KEY";
export const SUB2API_OPENAI_BASE_URL_PLACEHOLDER = "https://sub2api.example.com/openai/v1";
export const SUB2API_OPENAI_DEFAULT_MODEL_ID = "gpt-5.4";
export const SUB2API_OPENAI_DEFAULT_MODEL_REF = `${SUB2API_OPENAI_PROVIDER_ID}/${SUB2API_OPENAI_DEFAULT_MODEL_ID}`;
export const SUB2API_OPENAI_DEFAULT_MODEL: ModelDefinitionConfig = {
  id: SUB2API_OPENAI_DEFAULT_MODEL_ID,
  name: SUB2API_OPENAI_DEFAULT_MODEL_ID,
  api: "openai-responses",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 2.5,
    output: 15,
    cacheRead: 0.25,
    cacheWrite: 0,
  },
  contextWindow: 1_050_000,
  maxTokens: 128_000,
};

export const SUB2API_ANTHROPIC_PROVIDER_ID = "sub2api-anthropic";
export const SUB2API_ANTHROPIC_PROVIDER_LABEL = "Sub2API Anthropic";
export const SUB2API_ANTHROPIC_ENV_VAR = "SUB2API_ANTHROPIC_API_KEY";
export const SUB2API_ANTHROPIC_BASE_URL_PLACEHOLDER = "https://sub2api.example.com/anthropic/v1";
export const SUB2API_ANTHROPIC_DEFAULT_MODEL_ID = "claude-sonnet-4-6";
export const SUB2API_ANTHROPIC_DEFAULT_MODEL_REF = `${SUB2API_ANTHROPIC_PROVIDER_ID}/${SUB2API_ANTHROPIC_DEFAULT_MODEL_ID}`;
export const SUB2API_ANTHROPIC_DEFAULT_MODEL: ModelDefinitionConfig = {
  id: SUB2API_ANTHROPIC_DEFAULT_MODEL_ID,
  name: SUB2API_ANTHROPIC_DEFAULT_MODEL_ID,
  api: "anthropic-messages",
  reasoning: true,
  input: ["text", "image"],
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 200_000,
  maxTokens: 8_192,
};

export function applySub2ApiOpenAIConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(
    ensureModelAllowlistEntry({
      cfg,
      modelRef: SUB2API_OPENAI_DEFAULT_MODEL_REF,
      defaultProvider: SUB2API_OPENAI_PROVIDER_ID,
    }),
    SUB2API_OPENAI_DEFAULT_MODEL_REF,
  );
}

export function applySub2ApiAnthropicConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(
    ensureModelAllowlistEntry({
      cfg,
      modelRef: SUB2API_ANTHROPIC_DEFAULT_MODEL_REF,
      defaultProvider: SUB2API_ANTHROPIC_PROVIDER_ID,
    }),
    SUB2API_ANTHROPIC_DEFAULT_MODEL_REF,
  );
}

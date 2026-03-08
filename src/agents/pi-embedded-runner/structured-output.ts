import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

export const STRUCTURED_OUTPUT_SUPPORTED_APIS = new Set([
  "anthropic-messages",
  "openai-responses",
  "openai-codex-responses",
]);

const ORCH_DELEGATED_STRUCTURED_OUTPUT_SCHEMA_NAME = "openclaw_orch_delegated_result";

const ORCH_DELEGATED_STRUCTURED_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    result: {
      type: "object",
      additionalProperties: true,
    },
  },
  required: ["summary", "result"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

export type StructuredOutputRequest = {
  name: string;
  schema: Record<string, unknown>;
};

export const ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST: StructuredOutputRequest = {
  name: ORCH_DELEGATED_STRUCTURED_OUTPUT_SCHEMA_NAME,
  schema: ORCH_DELEGATED_STRUCTURED_OUTPUT_SCHEMA,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function supportsStructuredOutputApi(api: unknown): boolean {
  return typeof api === "string" && STRUCTURED_OUTPUT_SUPPORTED_APIS.has(api);
}

function buildAnthropicStructuredFormat(request: StructuredOutputRequest): Record<string, unknown> {
  return {
    type: "json_schema",
    name: request.name,
    schema: request.schema,
  };
}

function buildOpenAIStructuredFormat(request: StructuredOutputRequest): Record<string, unknown> {
  return {
    type: "json_schema",
    name: request.name,
    strict: false,
    schema: request.schema,
  };
}

export function injectStructuredOutputPayload(params: {
  model: { api?: unknown };
  payload: unknown;
  request?: StructuredOutputRequest;
}): boolean {
  if (!params.request) {
    return false;
  }

  const payload = asRecord(params.payload);
  if (!payload) {
    return false;
  }

  switch (params.model.api) {
    case "anthropic-messages": {
      const existingOutputConfig = asRecord(payload.output_config);
      payload.output_config = {
        ...existingOutputConfig,
        format: buildAnthropicStructuredFormat(params.request),
      };
      return true;
    }

    case "openai-responses":
    case "openai-codex-responses": {
      const existingText = asRecord(payload.text);
      payload.text = {
        ...existingText,
        format: buildOpenAIStructuredFormat(params.request),
      };
      return true;
    }

    default:
      return false;
  }
}

export function createStructuredOutputPayloadWrapper(
  baseStreamFn: StreamFn | undefined,
  request: StructuredOutputRequest,
): StreamFn {
  const streamFn = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    streamFn(model, context, {
      ...options,
      onPayload: (payload: unknown) => {
        injectStructuredOutputPayload({ model, payload, request });
        options?.onPayload?.(payload);
      },
    });
}

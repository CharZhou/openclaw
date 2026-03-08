import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Context, Model } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  createStructuredOutputPayloadWrapper,
  injectStructuredOutputPayload,
  ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
} from "./structured-output.js";

function findAdditionalPropertiesTrue(schema: unknown, path = "root"): string[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => findAdditionalPropertiesTrue(item, `${path}[${index}]`));
  }

  const record = schema as Record<string, unknown>;
  const matches = record.additionalProperties === true ? [path] : [];

  return [
    ...matches,
    ...Object.entries(record).flatMap(([key, value]) =>
      findAdditionalPropertiesTrue(value, `${path}.${key}`),
    ),
  ];
}

describe("injectStructuredOutputPayload", () => {
  it("uses a closed envelope schema without additionalProperties=true", () => {
    expect(ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema).toEqual({
      type: "object",
      properties: {
        ok: { type: "boolean" },
        summary: { type: "string" },
        result_json: { type: "string" },
        error_message: { type: "string" },
      },
      required: ["ok", "summary", "result_json", "error_message"],
      additionalProperties: false,
    });
    expect(findAdditionalPropertiesTrue(ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema)).toEqual(
      [],
    );
  });

  it("merges Anthropic output_config.format without clobbering existing output_config", () => {
    const payload: Record<string, unknown> = {
      output_config: { effort: "low" },
    };

    const injected = injectStructuredOutputPayload({
      model: { api: "anthropic-messages" },
      payload,
      request: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
    });

    expect(injected).toBe(true);
    expect(payload.output_config).toEqual({
      effort: "low",
      format: {
        type: "json_schema",
        name: "openclaw_orch_delegated_result",
        schema: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema,
      },
    });
  });

  it("adds OpenAI Responses text.format while preserving existing payload fields", () => {
    const payload: Record<string, unknown> = {
      store: true,
      context_management: [{ type: "compaction", compact_threshold: 42_000 }],
    };

    const injected = injectStructuredOutputPayload({
      model: { api: "openai-responses" },
      payload,
      request: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
    });

    expect(injected).toBe(true);
    expect(payload).toMatchObject({
      store: true,
      context_management: [{ type: "compaction", compact_threshold: 42_000 }],
      text: {
        format: {
          type: "json_schema",
          name: "openclaw_orch_delegated_result",
          strict: false,
          schema: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema,
        },
      },
    });
  });

  it("merges OpenAI Codex text.format without clobbering existing text settings", () => {
    const payload: Record<string, unknown> = {
      text: { verbosity: "medium" },
    };

    const injected = injectStructuredOutputPayload({
      model: { api: "openai-codex-responses" },
      payload,
      request: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
    });

    expect(injected).toBe(true);
    expect(payload.text).toEqual({
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: "openclaw_orch_delegated_result",
        strict: false,
        schema: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema,
      },
    });
  });

  it("ignores unsupported APIs", () => {
    const payload: Record<string, unknown> = {};

    const injected = injectStructuredOutputPayload({
      model: { api: "openai-completions" },
      payload,
      request: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
    });

    expect(injected).toBe(false);
    expect(payload).toEqual({});
  });
});

describe("createStructuredOutputPayloadWrapper", () => {
  it("injects structured output payloads and preserves downstream onPayload hooks", () => {
    const payload: Record<string, unknown> = { text: { verbosity: "low" } };
    const downstream = vi.fn();
    const baseStreamFn: StreamFn = (_model, _context, options) => {
      options?.onPayload?.(payload);
      return {} as ReturnType<StreamFn>;
    };

    const wrapped = createStructuredOutputPayloadWrapper(
      baseStreamFn,
      ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
    );

    void wrapped(
      {
        api: "openai-codex-responses",
        provider: "openai-codex",
        id: "gpt-5.3-codex",
      } as Model<"openai-codex-responses">,
      { messages: [] } as Context,
      { onPayload: downstream },
    );

    expect(payload.text).toEqual({
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "openclaw_orch_delegated_result",
        strict: false,
        schema: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST.schema,
      },
    });
    expect(downstream).toHaveBeenCalledWith(payload);
  });
});

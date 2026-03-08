import { describe, expect, it, vi } from "vitest";
import { runToolModelOrchestrator } from "./orchestrator.js";
import { ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST } from "./structured-output.js";

const BASE_ARGS = {
  task: "Summarize telemetry and compute key deltas",
  goal: "Return machine-readable summary",
  return_format: "structured_json" as const,
  success_criteria: "Includes summary and a JSON-encoded result payload",
};

describe("runToolModelOrchestrator", () => {
  it("parses result_json from the structured output envelope", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [
        {
          text: '{"ok":true,"summary":"done","result_json":"{\\"delta\\":42}","error_message":""}',
        },
      ],
      meta: { durationMs: 12 },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(runEmbedded).toHaveBeenCalledTimes(1);
    expect(runEmbedded.mock.calls[0]?.[0]).toMatchObject({
      structuredOutput: ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST,
      disableOrchestrationDelegateTool: true,
    });
    expect(result).toEqual({
      ok: true,
      summary: "done",
      result: { delta: 42 },
    });
  });

  it("preserves the legacy result-object fallback", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [
        {
          text: '{"summary":"done","result":{"delta":42}}',
        },
      ],
      meta: { durationMs: 12 },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(result).toEqual({
      ok: true,
      summary: "done",
      result: { delta: 42 },
    });
  });

  it("returns a structured failure when the envelope reports ok=false", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [
        {
          text: '{"ok":false,"summary":"delegate failed","result_json":"null","error_message":"rate limited"}',
        },
      ],
      meta: { durationMs: 11 },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(result).toEqual({
      ok: false,
      summary: "delegate failed",
      error: {
        message: "rate limited",
      },
    });
  });

  it("keeps the raw result_json string when the inner JSON parse fails", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [
        {
          text: '{"ok":true,"summary":"done","result_json":"{bad-json","error_message":""}',
        },
      ],
      meta: { durationMs: 12 },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(result).toEqual({
      ok: true,
      summary: "done",
      result: "{bad-json",
    });
  });

  it("returns standardized failure when delegated output is not valid JSON", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [{ text: "not-json" }],
      meta: { durationMs: 8 },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("not valid structured_json");
    if (!result.ok) {
      expect(result.error.message).toContain("Expected a JSON object");
      expect(result.error.raw).toBe("not-json");
    }
  });

  it("returns standardized failure when delegated run returns a runtime error", async () => {
    const runEmbedded = vi.fn(async () => ({
      payloads: [],
      meta: {
        durationMs: 9,
        error: {
          kind: "retry_limit" as const,
          message: "provider timeout",
        },
      },
    }));

    const result = await runToolModelOrchestrator(
      {
        args: BASE_ARGS,
        config: {
          orchestration: {
            enabled: true,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
        workspaceDir: process.cwd(),
      },
      { runEmbedded },
    );

    expect(result).toEqual({
      ok: false,
      summary: "Tool model run failed.",
      error: {
        message: "provider timeout",
      },
    });
  });
});

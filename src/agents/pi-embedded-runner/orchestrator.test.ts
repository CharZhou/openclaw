import { describe, expect, it, vi } from "vitest";
import { runToolModelOrchestrator } from "./orchestrator.js";

const BASE_ARGS = {
  task: "Summarize telemetry and compute key deltas",
  goal: "Return machine-readable summary",
  return_format: "structured_json" as const,
  success_criteria: "Includes summary and result object",
};

describe("runToolModelOrchestrator", () => {
  it("normalizes successful structured_json output", async () => {
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

    expect(runEmbedded).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "done",
      result: { delta: 42 },
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

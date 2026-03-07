import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

const ORCH_CONFIG: OpenClawConfig = {
  orchestration: {
    enabled: true,
    toolModel: "anthropic/claude-3-5-haiku",
  },
};

describe("createOpenClawCodingTools orchestration injection", () => {
  it("injects delegate_to_tool_model when orchestration is enabled", () => {
    const names = new Set(
      createOpenClawCodingTools({
        config: ORCH_CONFIG,
      }).map((tool) => tool.name),
    );

    expect(names.has("delegate_to_tool_model")).toBe(true);
  });

  it("does not inject delegate_to_tool_model when orchestration is disabled", () => {
    const names = new Set(
      createOpenClawCodingTools({
        config: {
          orchestration: {
            enabled: false,
            toolModel: "anthropic/claude-3-5-haiku",
          },
        },
      }).map((tool) => tool.name),
    );

    expect(names.has("delegate_to_tool_model")).toBe(false);
  });

  it("does not inject delegate_to_tool_model without orchestration.toolModel", () => {
    const names = new Set(
      createOpenClawCodingTools({
        config: {
          orchestration: {
            enabled: true,
          },
        },
      }).map((tool) => tool.name),
    );

    expect(names.has("delegate_to_tool_model")).toBe(false);
  });

  it("does not inject delegate_to_tool_model for delegated tool-model runs", () => {
    const names = new Set(
      createOpenClawCodingTools({
        config: ORCH_CONFIG,
        disableOrchestrationDelegateTool: true,
      }).map((tool) => tool.name),
    );

    expect(names.has("delegate_to_tool_model")).toBe(false);
  });
});

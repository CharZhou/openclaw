import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveModelAlias } from "./model-alias.js";

describe("resolveModelAlias", () => {
  it("returns parsed provider/model for explicit format", () => {
    const result = resolveModelAlias("anthropic/claude-sonnet-4-5");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("resolves alias from models catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-haiku-4-5": { alias: "fast" },
            "anthropic/claude-sonnet-4-5": { alias: "main" },
            "anthropic/claude-opus-4-6": { alias: "deep" },
          },
        },
      },
    } as unknown as OpenClawConfig;

    const fast = resolveModelAlias("fast", cfg);
    expect(fast.provider).toBe("anthropic");
    expect(fast.model).toBe("claude-haiku-4-5");

    const deep = resolveModelAlias("deep", cfg);
    expect(deep.provider).toBe("anthropic");
    expect(deep.model).toBe("claude-opus-4-6");
  });

  it("falls back to default provider when alias not found in catalog", () => {
    const result = resolveModelAlias("unknown-model");
    expect(result.model).toBe("unknown-model");
    // provider should be some default, not empty
    expect(result.provider).toBeTruthy();
  });

  it("handles empty config gracefully", () => {
    const cfg = { agents: { defaults: {} } } as OpenClawConfig;
    const result = resolveModelAlias("fast", cfg);
    // Should not throw, falls back
    expect(result).toBeDefined();
    expect(result.model).toBeDefined();
  });

  it("handles undefined config gracefully", () => {
    const result = resolveModelAlias("main");
    expect(result).toBeDefined();
  });

  it("prefers explicit provider/model over alias lookup", () => {
    const cfg = {
      agents: {
        defaults: {
          models: {
            "anthropic/claude-haiku-4-5": { alias: "fast" },
          },
        },
      },
    } as unknown as OpenClawConfig;

    // Even though "fast" is an alias, "openai/gpt-4" should parse directly
    const result = resolveModelAlias("openai/gpt-4", cfg);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
  });
});

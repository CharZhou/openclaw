import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveMultiModelConfig, resolveRoleConfig } from "./role-registry.js";

describe("resolveMultiModelConfig", () => {
  it("returns defaults when no config provided", () => {
    const result = resolveMultiModelConfig();
    expect(result.enabled).toBe(false);
    expect(result.maxDelegatesPerTurn).toBe(3);
    expect(result.delegateTimeoutSeconds).toBe(180);
    expect(result.lane.maxConcurrent).toBe(4);
    expect(Object.keys(result.roles)).toEqual(["research", "plan", "implement", "review"]);
  });

  it("returns defaults when config has no multiModel", () => {
    const cfg = { agents: { defaults: {} } } as OpenClawConfig;
    const result = resolveMultiModelConfig(cfg);
    expect(result.enabled).toBe(false);
    expect(result.roles.research.model).toBe("fast");
  });

  it("merges partial config over defaults", () => {
    const cfg = {
      agents: {
        defaults: {
          multiModel: {
            enabled: true,
            maxDelegatesPerTurn: 5,
            roles: {
              research: { model: "custom/model" },
            },
          },
        },
      },
    } as unknown as OpenClawConfig;
    const result = resolveMultiModelConfig(cfg);
    expect(result.enabled).toBe(true);
    expect(result.maxDelegatesPerTurn).toBe(5);
    expect(result.delegateTimeoutSeconds).toBe(180); // still default
    expect(result.roles.research.model).toBe("custom/model");
    expect(result.roles.research.thinking).toBe("low"); // default preserved
    expect(result.roles.plan.model).toBe("deep"); // untouched role preserved
  });

  it("preserves default role tools when not overridden", () => {
    const cfg = {
      agents: {
        defaults: {
          multiModel: {
            enabled: true,
            roles: {
              implement: { maxTurns: 10 },
            },
          },
        },
      },
    } as unknown as OpenClawConfig;
    const result = resolveMultiModelConfig(cfg);
    expect(result.roles.implement.maxTurns).toBe(10);
    expect(result.roles.implement.tools).toEqual(["read", "edit", "write", "exec"]);
    expect(result.roles.implement.writable).toBe(true);
  });
});

describe("resolveRoleConfig", () => {
  it("returns default config for known role", () => {
    const config = resolveRoleConfig("research");
    expect(config.model).toBe("fast");
    expect(config.thinking).toBe("low");
    expect(config.writable).toBe(false);
  });

  it("returns overridden config when provided", () => {
    const cfg = {
      agents: {
        defaults: {
          multiModel: {
            enabled: true,
            roles: {
              review: { model: "main", maxTurns: 8 },
            },
          },
        },
      },
    } as unknown as OpenClawConfig;
    const config = resolveRoleConfig("review", cfg);
    expect(config.model).toBe("main");
    expect(config.maxTurns).toBe(8);
    expect(config.thinking).toBe("high"); // default preserved
  });

  it("each default role has expected properties", () => {
    for (const role of ["research", "plan", "implement", "review"] as const) {
      const config = resolveRoleConfig(role);
      expect(config.model).toBeDefined();
      expect(config.thinking).toBeDefined();
      expect(config.tools).toBeInstanceOf(Array);
      expect(typeof config.writable).toBe("boolean");
      expect(typeof config.maxTurns).toBe("number");
    }
  });

  it("implement role has writable=true by default", () => {
    expect(resolveRoleConfig("implement").writable).toBe(true);
  });

  it("non-implement roles have writable=false by default", () => {
    expect(resolveRoleConfig("research").writable).toBe(false);
    expect(resolveRoleConfig("plan").writable).toBe(false);
    expect(resolveRoleConfig("review").writable).toBe(false);
  });
});

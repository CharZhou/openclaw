import type { OpenClawConfig } from "../../config/config.js";
import type { DelegateRole, RoleConfig, MultiModelConfig } from "./types.js";

const DEFAULT_ROLES: Record<DelegateRole, RoleConfig> = {
  research: {
    model: "fast",
    thinking: "low",
    tools: ["read", "exec", "browser", "web_search", "web_fetch"],
    writable: false,
    maxTurns: 3,
  },
  plan: {
    model: "deep",
    thinking: "high",
    tools: ["read", "exec"],
    writable: false,
    maxTurns: 3,
  },
  implement: {
    model: "main",
    thinking: "medium",
    tools: ["read", "edit", "write", "exec"],
    writable: true,
    maxTurns: 6,
  },
  review: {
    model: "deep",
    thinking: "high",
    tools: ["read", "exec"],
    writable: false,
    maxTurns: 4,
  },
};

const DEFAULT_MULTI_MODEL: MultiModelConfig = {
  enabled: false,
  maxDelegatesPerTurn: 3,
  delegateTimeoutSeconds: 180,
  lane: { maxConcurrent: 4 },
  roles: DEFAULT_ROLES,
};

export function resolveMultiModelConfig(cfg?: OpenClawConfig): MultiModelConfig {
  const raw = (cfg?.agents?.defaults as Record<string, unknown>)?.multiModel as
    | Partial<MultiModelConfig>
    | undefined;
  if (!raw) {
    return DEFAULT_MULTI_MODEL;
  }

  return {
    enabled: raw.enabled ?? DEFAULT_MULTI_MODEL.enabled,
    maxDelegatesPerTurn: raw.maxDelegatesPerTurn ?? DEFAULT_MULTI_MODEL.maxDelegatesPerTurn,
    delegateTimeoutSeconds:
      raw.delegateTimeoutSeconds ?? DEFAULT_MULTI_MODEL.delegateTimeoutSeconds,
    lane: {
      maxConcurrent: raw.lane?.maxConcurrent ?? DEFAULT_MULTI_MODEL.lane.maxConcurrent,
    },
    roles: {
      ...DEFAULT_MULTI_MODEL.roles,
      ...Object.fromEntries(
        Object.entries(raw.roles ?? {}).map(([role, partial]) => [
          role,
          { ...DEFAULT_ROLES[role as DelegateRole], ...partial },
        ]),
      ),
    } as Record<DelegateRole, RoleConfig>,
  };
}

export function resolveRoleConfig(role: DelegateRole, cfg?: OpenClawConfig): RoleConfig {
  return resolveMultiModelConfig(cfg).roles[role];
}

import { loadConfig } from "../../config/config.js";
import { resolveOpenClawAgentDir } from "../agent-paths.js";
import { resolveDefaultAgentId, resolveAgentDir } from "../agent-scope.js";

/**
 * Resolve the primary auth store owner for the current runtime.
 *
 * Precedence:
 * 1. Explicit agent-dir env overrides remain authoritative.
 * 2. Otherwise, use the configured default agent.
 * 3. Fall back to the legacy/main agent path when config is unavailable.
 */
export function resolvePrimaryAuthAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPENCLAW_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim()) {
    return resolveOpenClawAgentDir(env);
  }

  try {
    const cfg = loadConfig();
    const defaultAgentId = resolveDefaultAgentId(cfg);
    return resolveAgentDir(cfg, defaultAgentId, env);
  } catch {
    return resolveOpenClawAgentDir(env);
  }
}

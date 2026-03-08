import type { OpenClawConfig } from "../../config/config.js";
import { DEFAULT_PROVIDER } from "../defaults.js";
import { parseModelRef } from "../model-selection.js";

/**
 * 从 agents.defaults.models 里找 alias 对应的 provider/model。
 * 如果 alias 直接是 "provider/model" 格式，原样返回。
 */
export function resolveModelAlias(
  alias: string,
  cfg?: OpenClawConfig,
): { provider: string; model: string } {
  // 如果已经是 provider/model 格式
  if (alias.includes("/")) {
    const parsed = parseModelRef(alias, DEFAULT_PROVIDER);
    if (parsed) {
      return parsed;
    }
  }

  // 从 models catalog 里搜 alias
  const models = (cfg?.agents?.defaults as Record<string, unknown>)?.models as
    | Record<string, { alias?: string }>
    | undefined;
  if (models) {
    for (const [key, entry] of Object.entries(models)) {
      if (entry?.alias === alias) {
        const parsed = parseModelRef(key, DEFAULT_PROVIDER);
        if (parsed) {
          return parsed;
        }
      }
    }
  }

  // fallback：把 alias 当 model id，用默认 provider
  const parsed = parseModelRef(alias, DEFAULT_PROVIDER);
  if (parsed) {
    return parsed;
  }

  // 最终 fallback
  return { provider: DEFAULT_PROVIDER, model: alias };
}

import { randomBytes } from "node:crypto";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { runEmbeddedPiAgent } from "../pi-embedded-runner/run.js";
import { resolveModelAlias } from "./model-alias.js";
import { resolveMultiModelConfig, resolveRoleConfig } from "./role-registry.js";
import type { DelegateRole, DelegateRunInput, DelegateRunOutput } from "./types.js";

const DELEGATE_LANE_PREFIX = "delegate";

function createDelegateSessionKey(parentSessionKey: string, role: DelegateRole): string {
  const suffix = randomBytes(4).toString("hex");
  return `${parentSessionKey}:delegate:${role}:${suffix}`;
}

function createDelegateSessionId(): string {
  return `delegate-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

/**
 * 构建传给 child 的 system prompt 片段
 */
function buildChildTaskPrompt(input: DelegateRunInput): string {
  const lines: string[] = [
    `# Delegated Task`,
    ``,
    `**Role:** ${input.role}`,
    `**Task:** ${input.task}`,
  ];

  if (input.context) {
    lines.push(``, `**Context:**`, input.context);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Output Requirements`,
    ``,
    `You MUST respond with a structured summary in the following format:`,
    ``,
    "```",
    `Summary:`,
    `- What you found / did / concluded`,
    ``,
    `Evidence:`,
    `- File paths, diffs, command results, or key data points`,
    ``,
    `Recommendation:`,
    `- What the parent session should do next`,
    "```",
    ``,
    `Be concise. Do NOT include full file contents or raw logs unless specifically asked.`,
    `Focus on actionable conclusions.`,
  );

  return lines.join("\n");
}

export interface DelegateRunnerParams {
  input: DelegateRunInput;
  parentSessionKey: string;
  config?: OpenClawConfig;
  workspaceDir: string;
  agentDir?: string;
  parentRunId?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
}

export async function executeDelegateRun(params: DelegateRunnerParams): Promise<DelegateRunOutput> {
  const started = Date.now();
  const { input, config } = params;

  // 1. 解析角色配置
  const roleConfig = resolveRoleConfig(input.role, config);

  // 2. 解析模型
  const modelRef = input.model
    ? resolveModelAlias(input.model, config)
    : resolveModelAlias(roleConfig.model, config);

  // 3. 创建 child session
  const childSessionKey = createDelegateSessionKey(params.parentSessionKey, input.role);
  const childSessionId = createDelegateSessionId();

  // 4. 构建 child prompt
  const taskPrompt = buildChildTaskPrompt(input);

  // 5. 确定超时
  const timeoutMs =
    (input.timeoutSeconds ?? resolveMultiModelConfig(config).delegateTimeoutSeconds) * 1000;

  // 6. 确定 thinking
  const thinking = input.thinking ?? roleConfig.thinking;

  // 7. 创建临时 session 文件路径
  const sessionFile = path.join(
    params.agentDir ?? params.workspaceDir,
    ".openclaw",
    "sessions",
    `${childSessionId}.jsonl`,
  );

  try {
    // 8. 同步执行 child
    const result = await runEmbeddedPiAgent({
      sessionId: childSessionId,
      sessionKey: childSessionKey,
      runId: `${params.parentRunId ?? "unknown"}-delegate-${input.role}`,
      provider: modelRef.provider,
      model: modelRef.model,
      prompt: taskPrompt,
      sessionFile,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      config,
      messageChannel: params.messageChannel,
      messageProvider: params.messageProvider,
      agentAccountId: params.agentAccountId,
      thinkLevel: thinking,
      timeoutMs,
      lane: `${DELEGATE_LANE_PREFIX}:${input.role}`,
      // child 不需要持久化 session，用一次性 session 文件
      disableMessageTool: true, // child 不应该直接给用户发消息
      requireExplicitMessageTarget: true,
      // TODO: 工具裁剪根据 roleConfig.tools
    });

    const summary =
      result.payloads?.[0]?.text ?? result.meta.error?.message ?? "No output from delegate";
    const effectiveModel = `${modelRef.provider}/${modelRef.model}`;

    return {
      status: result.meta.error ? "error" : "ok",
      role: input.role,
      childSessionKey,
      effectiveModel,
      summary: truncateSummary(summary, input.summaryMode ?? "standard"),
      usage: result.meta.agentMeta?.usage
        ? {
            inputTokens: result.meta.agentMeta.usage.input,
            outputTokens: result.meta.agentMeta.usage.output,
            totalTokens: result.meta.agentMeta.usage.total,
          }
        : undefined,
      error: result.meta.error?.message ?? undefined,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: "error",
      role: input.role,
      childSessionKey,
      effectiveModel: `${modelRef.provider}/${modelRef.model}`,
      summary: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

function truncateSummary(text: string, mode: "brief" | "standard" | "detailed"): string {
  const limits: Record<string, number> = {
    brief: 2000,
    standard: 6000,
    detailed: 16000,
  };
  const limit = limits[mode] ?? 6000;
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + "\n\n[... truncated to " + mode + " mode limit]";
}

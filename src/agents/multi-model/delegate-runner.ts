import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import type { OpenClawConfig } from "../../config/config.js";
import { logInfo } from "../../logger.js";
import { runEmbeddedPiAgent } from "../pi-embedded-runner/run.js";
import { resolveModelAlias } from "./model-alias.js";
import { resolveMultiModelConfig, resolveRoleConfig } from "./role-registry.js";
import type { DelegateRole, DelegateRunInput, DelegateRunOutput } from "./types.js";

const execFileAsync = promisify(execFile);

const DELEGATE_LANE_PREFIX = "delegate";
const TREE_MAX_CHARS = 4000;

function createDelegateSessionKey(parentSessionKey: string, role: DelegateRole): string {
  const suffix = randomBytes(4).toString("hex");
  return `${parentSessionKey}:delegate:${role}:${suffix}`;
}

function createDelegateSessionId(): string {
  return `delegate-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

/**
 * 生成 workspace 的简要文件树（深度 3，排除常见噪音目录）
 */
async function generateWorkspaceTree(workspaceDir: string): Promise<string> {
  try {
    // 优先用 find（跨平台比 tree 更可靠）
    const { stdout } = await execFileAsync(
      "find",
      [
        workspaceDir,
        "-maxdepth",
        "3",
        "-not",
        "-path",
        "*/node_modules/*",
        "-not",
        "-path",
        "*/.git/*",
        "-not",
        "-path",
        "*/.next/*",
        "-not",
        "-path",
        "*/dist/*",
        "-not",
        "-path",
        "*/.openclaw/sessions/*",
        "-not",
        "-path",
        "*/__pycache__/*",
        "-not",
        "-name",
        "*.jsonl",
        "-not",
        "-name",
        "*.log",
      ],
      { timeout: 5000, maxBuffer: 1024 * 256 },
    );

    const trimmed = stdout.trim();
    if (trimmed.length > TREE_MAX_CHARS) {
      return trimmed.slice(0, TREE_MAX_CHARS) + "\n... (truncated)";
    }
    return trimmed;
  } catch {
    return "(file tree unavailable)";
  }
}

/**
 * 构建传给 child 的 system prompt 片段
 */
function buildChildTaskPrompt(input: DelegateRunInput, opts?: { workspaceTree?: string }): string {
  const lines: string[] = [
    `# Delegated Task`,
    ``,
    `**Role:** ${input.role}`,
    `**Task:** ${input.task}`,
  ];

  if (input.context) {
    lines.push(``, `**Context:**`, input.context);
  }

  if (opts?.workspaceTree) {
    lines.push(
      ``,
      `## Workspace File Tree`,
      ``,
      `Below is a summary of key files/directories in the workspace. Use this to navigate efficiently instead of running broad \`find\` commands:`,
      ``,
      "```",
      opts.workspaceTree,
      "```",
    );
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Execution Strategy`,
    ``,
    `**IMPORTANT:** You have a limited time budget. Follow this strategy:`,
    `1. Start with targeted reads/greps based on the file tree above — avoid broad \`find\` scans`,
    `2. After gathering enough evidence (even if not exhaustive), produce your summary IMMEDIATELY`,
    `3. Do NOT wait until you have "complete" data — partial but structured output is far better than being cut off mid-investigation`,
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
    logInfo(
      `multi-model:delegate: [delegate-run] role=${input.role} model=${modelRef.provider}/${modelRef.model} timeout=${timeoutMs}ms session=${childSessionId}`,
    );

    // 4. 生成 workspace tree
    let workspaceTree: string | undefined;
    try {
      workspaceTree = await generateWorkspaceTree(params.workspaceDir);
    } catch {
      // 非关键，忽略
    }

    // 构建 child prompt
    const taskPrompt = buildChildTaskPrompt(input, { workspaceTree });

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

    const output: DelegateRunOutput = {
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

    logInfo(
      `multi-model:delegate: [delegate-run] role=${input.role} status=${result.meta.error ? "error" : "ok"} duration=${Date.now() - started}ms session=${childSessionId}`,
    );

    return output;
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

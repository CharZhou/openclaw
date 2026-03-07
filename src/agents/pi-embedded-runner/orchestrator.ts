import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { DEFAULT_PROVIDER } from "../defaults.js";
import { parseModelRef } from "../model-selection.js";
import { runEmbeddedPiAgent } from "./run.js";

const STRUCTURED_JSON_FORMAT = "structured_json";
const DEFAULT_TOOL_MODEL_TIMEOUT_MS = 60_000;
const MAX_TOOL_MODEL_RAW_ERROR_CHARS = 4_000;

export type DelegateToToolModelArgs = {
  task: string;
  goal: string;
  return_format: "structured_json";
  success_criteria: string;
};

export type ToolModelOrchestratorResult =
  | {
      ok: true;
      summary: string;
      result: unknown;
    }
  | {
      ok: false;
      summary: string;
      error: {
        message: string;
        raw?: string;
      };
    };

export type ToolModelOrchestratorParams = {
  args: DelegateToToolModelArgs;
  config?: OpenClawConfig;
  sessionKey?: string;
  workspaceDir: string;
  agentDir?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
  runId?: string;
  timeoutMs?: number;
};

type RunEmbeddedPiAgentFn = typeof runEmbeddedPiAgent;

type OrchestratorDeps = {
  runEmbedded?: RunEmbeddedPiAgentFn;
};

type PayloadLike = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

function createEphemeralId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

function extractJsonPayloadCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed];
  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedBlocks) {
    const block = match[1]?.trim();
    if (block) {
      candidates.push(block);
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return Array.from(new Set(candidates));
}

function parseStructuredJsonOutput(text: string): Record<string, unknown> | null {
  for (const candidate of extractJsonPayloadCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Keep trying additional candidates.
    }
  }
  return null;
}

function buildToolModelPrompt(args: DelegateToToolModelArgs): string {
  return [
    "You are a delegated tool-model worker for OpenClaw orchestration.",
    "Treat this as an internal execution step, not a user-facing conversation.",
    "Do the task, then return exactly one raw JSON object.",
    "Do not output markdown fences, code fences, preambles, progress notes, or explanatory prose.",
    "Do not narrate what you are about to do. Just do it and return the final JSON object.",
    "",
    "Required JSON shape:",
    '{ "summary": "string", "result": {} }',
    "",
    `Task: ${args.task}`,
    `Goal: ${args.goal}`,
    `Success criteria: ${args.success_criteria}`,
    `Return format: ${STRUCTURED_JSON_FORMAT}`,
  ].join("\n");
}

function collectPayloadText(payloads: PayloadLike[] | undefined): string | undefined {
  if (!payloads || payloads.length === 0) {
    return undefined;
  }
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const text = payloads[index]?.text?.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function collectStructuredTextFromOpenAIStyleResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;

  const output = record.output;
  if (!Array.isArray(output)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const itemRecord = item as Record<string, unknown>;
    const content = itemRecord.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === "output_text" && typeof blockRecord.text === "string") {
        parts.push(blockRecord.text);
      }
      if (blockRecord.type === "text" && typeof blockRecord.text === "string") {
        parts.push(blockRecord.text);
      }
    }
  }

  const joined = parts.join("\n").trim();
  return joined || undefined;
}

function collectStructuredOutputText(params: {
  payloads: PayloadLike[] | undefined;
  nestedResult: unknown;
}): string | undefined {
  return (
    collectPayloadText(params.payloads) ??
    collectStructuredTextFromOpenAIStyleResult(params.nestedResult)
  );
}

function resolveToolModelRef(config?: OpenClawConfig): { provider: string; model: string } | null {
  const configured = config?.orchestration?.toolModel?.trim();
  if (!configured) {
    return null;
  }
  if (!configured.includes("/")) {
    return null;
  }
  return parseModelRef(configured, DEFAULT_PROVIDER);
}

export async function runToolModelOrchestrator(
  params: ToolModelOrchestratorParams,
  deps: OrchestratorDeps = {},
): Promise<ToolModelOrchestratorResult> {
  if (params.args.return_format !== STRUCTURED_JSON_FORMAT) {
    return {
      ok: false,
      summary: "Unsupported return_format for delegation.",
      error: {
        message: 'return_format must be "structured_json"',
      },
    };
  }

  const toolModel = resolveToolModelRef(params.config);
  if (!toolModel) {
    return {
      ok: false,
      summary: "Tool model is not configured.",
      error: {
        message: "Set orchestration.toolModel to provider/model before delegating.",
      },
    };
  }

  const runEmbedded = deps.runEmbedded ?? runEmbeddedPiAgent;
  const sessionId = createEphemeralId("orch-tool");
  const nestedRunId = createEphemeralId("orch-run");
  const nestedSessionKey = `agent:orch:${sessionId}`;
  const sessionFile = path.join(os.tmpdir(), `openclaw-orchestration-${sessionId}.jsonl`);

  try {
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    const nestedResult = await runEmbedded({
      sessionId,
      sessionFile,
      sessionKey: nestedSessionKey,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      config: params.config,
      prompt: buildToolModelPrompt(params.args),
      provider: toolModel.provider,
      model: toolModel.model,
      timeoutMs: params.timeoutMs ?? DEFAULT_TOOL_MODEL_TIMEOUT_MS,
      runId: params.runId ? `${params.runId}:${nestedRunId}` : nestedRunId,
      messageChannel: params.messageChannel,
      messageProvider: params.messageProvider,
      agentAccountId: params.agentAccountId,
      thinkLevel: "low",
      reasoningLevel: "off",
      verboseLevel: "off",
      toolResultFormat: "plain",
      disableMessageTool: true,
      requireExplicitMessageTarget: true,
      disableOrchestrationDelegateTool: true,
    });

    if (nestedResult.meta.error) {
      return {
        ok: false,
        summary: "Tool model run failed.",
        error: {
          message: nestedResult.meta.error.message,
        },
      };
    }

    const rawText = collectStructuredOutputText({
      payloads: nestedResult.payloads,
      nestedResult,
    });
    if (!rawText) {
      return {
        ok: false,
        summary: "Tool model returned no structured output.",
        error: {
          message: "No text payload from delegated run.",
        },
      };
    }

    const parsed = parseStructuredJsonOutput(rawText);
    if (!parsed) {
      return {
        ok: false,
        summary: "Tool model output was not valid structured_json.",
        error: {
          message: "Expected a JSON object in delegated output.",
          raw: rawText.slice(0, MAX_TOOL_MODEL_RAW_ERROR_CHARS),
        },
      };
    }

    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Delegated task completed.";
    const result = Object.hasOwn(parsed, "result") ? parsed.result : parsed;

    return {
      ok: true,
      summary,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: "Tool model orchestration failed.",
      error: { message },
    };
  } finally {
    await fs.rm(sessionFile, { force: true }).catch(() => {});
  }
}

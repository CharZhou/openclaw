import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { executeDelegateRun } from "../multi-model/delegate-runner.js";
import type { DelegateRole, DelegateRunInput } from "../multi-model/types.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, ToolInputError } from "./common.js";

const VALID_ROLES = ["research", "plan", "implement", "review"] as const;
const VALID_SUMMARY_MODES = ["brief", "standard", "detailed"] as const;

const DelegateRunSchema = Type.Object({
  role: stringEnum(VALID_ROLES, {
    description:
      "Role determines the default model, tools, and permissions. " +
      "research=fast read-only scanning, plan=deep read-only analysis, " +
      "implement=code changes with write access, review=deep read-only review.",
  }),
  task: Type.String({
    description: "Clear, specific task description for the delegate worker.",
  }),
  context: Type.Optional(
    Type.String({
      description: "Additional context: file paths, code snippets, constraints. Keep concise.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        'Override the role default model. Use alias ("fast","main","deep","coder") or "provider/model".',
    }),
  ),
  thinking: Type.Optional(
    stringEnum(["off", "low", "medium", "high"], {
      description: "Override thinking/reasoning level for the delegate.",
    }),
  ),
  summaryMode: Type.Optional(
    stringEnum([...VALID_SUMMARY_MODES], {
      description: "Controls how much detail the delegate returns. Default: standard.",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "Override timeout in seconds. Default from config.",
    }),
  ),
});

export type DelegateRunToolOptions = {
  config?: OpenClawConfig;
  sessionKey?: string;
  workspaceDir: string;
  agentDir?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
  runId?: string;
};

export function createDelegateRunTool(options: DelegateRunToolOptions): AnyAgentTool {
  return {
    label: "Delegate Run",
    name: "delegate_run",
    description:
      "Synchronously delegate a sub-task to a worker model in an isolated child session. " +
      "The worker runs with a different model and returns a structured summary. " +
      "Use for: research/scanning (fast model), planning (deep model), " +
      "code implementation (coder model), or review (deep model). " +
      "Do NOT delegate trivial questions that you can answer directly.",
    parameters: DelegateRunSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const role = readStringParam(params, "role", { required: true }) as DelegateRole;
      const task = readStringParam(params, "task", { required: true });

      if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
        throw new ToolInputError(
          `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(", ")}`,
        );
      }

      const input: DelegateRunInput = {
        role,
        task,
        context: readStringParam(params, "context") || undefined,
        model: readStringParam(params, "model") || undefined,
        thinking:
          (readStringParam(params, "thinking") as DelegateRunInput["thinking"]) || undefined,
        summaryMode:
          (readStringParam(params, "summaryMode") as DelegateRunInput["summaryMode"]) || undefined,
        timeoutSeconds:
          typeof params.timeoutSeconds === "number" ? params.timeoutSeconds : undefined,
      };

      const result = await executeDelegateRun({
        input,
        parentSessionKey: options.sessionKey ?? "unknown",
        config: options.config,
        workspaceDir: options.workspaceDir,
        agentDir: options.agentDir,
        parentRunId: options.runId,
        messageChannel: options.messageChannel,
        messageProvider: options.messageProvider,
        agentAccountId: options.agentAccountId,
      });

      return jsonResult(result);
    },
  };
}

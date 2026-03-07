import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import {
  runToolModelOrchestrator,
  type DelegateToToolModelArgs,
  type ToolModelOrchestratorResult,
} from "../pi-embedded-runner/orchestrator.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, ToolInputError } from "./common.js";

const SUPPORTED_RETURN_FORMATS = ["structured_json"] as const;

const DelegateToToolModelSchema = Type.Object({
  task: Type.String({
    description: "Specific task details to delegate to the tool model.",
  }),
  goal: Type.String({
    description: "Expected high-level outcome from delegated execution.",
  }),
  return_format: stringEnum(SUPPORTED_RETURN_FORMATS, {
    description: "First MVP only supports structured_json.",
  }),
  success_criteria: Type.String({
    description: "Checklist used to evaluate delegated completion.",
  }),
});

export type DelegateToToolModelToolOptions = {
  config?: OpenClawConfig;
  sessionKey?: string;
  workspaceDir: string;
  agentDir?: string;
  messageChannel?: string;
  messageProvider?: string;
  agentAccountId?: string;
  runId?: string;
  timeoutMs?: number;
  orchestrate?: (params: {
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
  }) => Promise<ToolModelOrchestratorResult>;
};

export function createDelegateToToolModelTool(
  options: DelegateToToolModelToolOptions,
): AnyAgentTool {
  return {
    label: "Delegate To Tool Model",
    name: "delegate_to_tool_model",
    description:
      "Delegate bounded sub-tasks to a configured tool model and receive a structured JSON result for the main model to continue.",
    parameters: DelegateToToolModelSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const goal = readStringParam(params, "goal", { required: true });
      const returnFormat = readStringParam(params, "return_format", {
        required: true,
      });
      const successCriteria = readStringParam(params, "success_criteria", {
        required: true,
      });

      if (returnFormat !== "structured_json") {
        throw new ToolInputError("return_format must be structured_json");
      }

      const orchestrate = options.orchestrate ?? runToolModelOrchestrator;
      const result = await orchestrate({
        args: {
          task,
          goal,
          return_format: returnFormat,
          success_criteria: successCriteria,
        },
        config: options.config,
        sessionKey: options.sessionKey,
        workspaceDir: options.workspaceDir,
        agentDir: options.agentDir,
        messageChannel: options.messageChannel,
        messageProvider: options.messageProvider,
        agentAccountId: options.agentAccountId,
        runId: options.runId,
        timeoutMs: options.timeoutMs,
      });

      return jsonResult(result);
    },
  };
}

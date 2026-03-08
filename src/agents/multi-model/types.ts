export type DelegateRole = "research" | "plan" | "implement" | "review";

export interface DelegateRunInput {
  role: DelegateRole;
  task: string;
  context?: string; // 可选，给子模型的额外上下文（文件路径、代码片段等）
  model?: string; // 覆盖角色默认模型，格式: "provider/model" 或 alias
  thinking?: "off" | "low" | "medium" | "high";
  tools?: string[]; // 覆盖角色默认工具集
  timeoutSeconds?: number;
  maxTurns?: number;
  summaryMode?: "brief" | "standard" | "detailed";
}

export interface DelegateRunOutput {
  status: "ok" | "timeout" | "error";
  role: DelegateRole;
  childSessionKey: string;
  effectiveModel: string;
  summary: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  artifacts?: {
    files?: string[];
    notes?: string[];
  };
  error?: string;
  durationMs: number;
}

export interface RoleConfig {
  model: string; // alias 或 provider/model
  thinking: "off" | "low" | "medium" | "high";
  tools: string[];
  writable: boolean;
  maxTurns: number;
}

export interface MultiModelConfig {
  enabled: boolean;
  maxDelegatesPerTurn: number;
  delegateTimeoutSeconds: number;
  lane: {
    maxConcurrent: number;
  };
  roles: Record<DelegateRole, RoleConfig>;
}

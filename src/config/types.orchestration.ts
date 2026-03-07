export type OrchestrationConfig = {
  /** Enable orchestration mode and expose delegate_to_tool_model tool. */
  enabled?: boolean;
  /** Delegated tool model in provider/model format (for example anthropic/claude-3-5-haiku). */
  toolModel?: string;
};

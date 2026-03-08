import type { DelegateToToolModelArgs } from "./orchestrator.js";

export const ORCH_DELEGATE_ACTION_TYPE = "orch_delegate" as const;

type JsonRecord = Record<string, unknown>;

export type OrchDelegateAction = {
  type: typeof ORCH_DELEGATE_ACTION_TYPE;
  objective: string;
};

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

export function isOrchDelegateAction(value: unknown): value is OrchDelegateAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as JsonRecord;
  return (
    record.type === ORCH_DELEGATE_ACTION_TYPE &&
    typeof record.objective === "string" &&
    record.objective.trim().length > 0
  );
}

export function parseInternalOrchAction(text: string): OrchDelegateAction | null {
  for (const candidate of extractJsonPayloadCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isOrchDelegateAction(parsed)) {
        return {
          type: ORCH_DELEGATE_ACTION_TYPE,
          objective: parsed.objective.trim(),
        };
      }
    } catch {
      // Try additional candidates.
    }
  }
  return null;
}

export function buildDelegateArgsFromInternalAction(
  action: OrchDelegateAction,
): DelegateToToolModelArgs {
  const objective = action.objective.trim();
  return {
    task: objective,
    goal: objective,
    return_format: "structured_json",
    success_criteria: `Complete only this bounded objective and return a structured JSON result for it: ${objective}`,
  };
}

# 2026-03-08 OpenClaw orch structured outputs result

## Note

The requested source task doc `docs/tasks/2026-03-08-openclaw-orch-structured-outputs.md` was not present in this checkout at implementation time, so the change was grounded in the requested source files and the explicit scope from the task brief.

## Scope completed

Implemented structured outputs support only for orchestrated `delegate_to_tool_model` child runs.

Constraints preserved:

- Regular `runEmbeddedPiAgent` calls remain unchanged unless the internal delegated child-run flag is set.
- Prompt-only JSON instructions and the existing text parser fallback remain active.
- Native structured-output payload injection is limited to `model.api=anthropic-messages`, `openai-responses`, and `openai-codex-responses`.
- API-specific payload mutation is centralized in one internal helper module and covered by focused tests.

## Implementation

### New internal structured-output helper

Added `src/agents/pi-embedded-runner/structured-output.ts`.

This module now owns:

- the delegated child-run JSON schema wrapper (`summary` + `result`)
- API allowlisting for native structured outputs
- Anthropic payload injection via `output_config.format = { type: "json_schema", ... }`
- OpenAI Responses/Codex payload injection via `text.format = { type: "json_schema", ... }`
- safe merge behavior so existing Anthropic `output_config` and Codex/OpenAI `text` settings are preserved
- the stream wrapper that performs payload mutation through the existing `onPayload` interception pattern

### Delegated child-run only wiring

- `src/agents/pi-embedded-runner/orchestrator.ts`
  - passes the internal structured-output request only on delegated tool-model child runs
- `src/agents/pi-embedded-runner/run/params.ts`
  - adds an internal `structuredOutput` field to run params
- `src/agents/pi-embedded-runner/run.ts`
  - threads the internal `structuredOutput` field into attempt execution
- `src/agents/pi-embedded-runner/run/attempt.ts`
  - wraps the active stream function only when that internal flag is present

This keeps ordinary runs on the existing code path.

## Fallback behavior retained

The delegated prompt still explicitly requires one raw JSON object, and `runToolModelOrchestrator()` still parses the returned text with the existing fallback extractor. Native structured outputs are additive, not a replacement for prompt + parser behavior.

## Tests

Added/updated tests:

- `src/agents/pi-embedded-runner/structured-output.test.ts`
- `src/agents/pi-embedded-runner/orchestrator.test.ts`

Validated with:

```sh
pnpm exec vitest run \
  src/agents/pi-embedded-runner/structured-output.test.ts \
  src/agents/pi-embedded-runner/orchestrator.test.ts \
  src/agents/pi-embedded-runner/run/attempt.test.ts
```

Result: 3 test files passed, 40 tests passed.

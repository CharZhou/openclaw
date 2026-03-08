# 2026-03-08 OpenClaw orch anthropic format.name compatibility fix result

## Root cause

The delegated child-run structured output helper in
`src/agents/pi-embedded-runner/structured-output.ts` used the same schema-format payload shape
for all supported APIs.

That meant the `anthropic-messages` branch emitted:

```json
{
  "output_config": {
    "format": {
      "type": "json_schema",
      "name": "openclaw_orch_delegated_result",
      "schema": { "...": "..." }
    }
  }
}
```

Anthropic's current `output_config.format` validation rejects the delegated `name` field with:

> output_config.format.name: Extra inputs are not permitted

## Scope decision

I verified that the internal `structuredOutput` hook is only wired for orch delegated child runs:

- `src/agents/pi-embedded-runner/orchestrator.ts` passes `ORCH_DELEGATED_STRUCTURED_OUTPUT_REQUEST`
- `src/agents/pi-embedded-runner/run/attempt.ts` wraps the stream only when
  `params.structuredOutput` is present
- production callsites currently only set that field from the orchestrator path

So a minimal fix in the Anthropic branch of `injectStructuredOutputPayload()` stays inside the
requested scope and does not affect normal non-orch runs.

## Fix applied

Updated `src/agents/pi-embedded-runner/structured-output.ts`:

- `anthropic-messages` now emits only the minimal compatible payload:
  - `type: "json_schema"`
  - `schema`
- `output_config.format.name` is no longer sent for the Anthropic branch
- `openai-responses` and `openai-codex-responses` keep their existing `text.format.name`
  behavior unchanged

Updated `src/agents/pi-embedded-runner/structured-output.test.ts`:

- Anthropic assertion now verifies `format.name` is absent
- OpenAI Responses and OpenAI Codex assertions still verify `name` is present

## Validation

Formatted targeted files and ran focused Vitest coverage.

Commands used:

```sh
pnpm exec oxfmt --write \
  src/agents/pi-embedded-runner/structured-output.ts \
  src/agents/pi-embedded-runner/structured-output.test.ts

pnpm exec vitest run \
  src/agents/pi-embedded-runner/structured-output.test.ts \
  src/agents/pi-embedded-runner/orchestrator.test.ts
```

Result:

- 2 test files passed
- 12 tests passed
- Anthropic branch no longer expects `format.name`
- OpenAI Responses / OpenAI Codex branch assertions remained unchanged and passed
- Existing orchestrator tests remained green

## Files changed

- `src/agents/pi-embedded-runner/structured-output.ts`
- `src/agents/pi-embedded-runner/structured-output.test.ts`
- `docs/tasks/2026-03-08-openclaw-orch-anthropic-format-name-fix-result.md`

## Git note

While writing this result doc, I verified that the code fix itself was already present on the
current feature branch as:

- `504294b36` — `fix: omit anthropic structured output format name`
- already pushed to `origin/feat/orch-delegate-tool-model`

Judgment taken for this task:

- keep that existing feature-branch fix commit intact instead of rewriting pushed history
- add this result doc as a small follow-up commit
- record the exact final commit / push / merge state again in the handoff message

# 2026-03-08 OpenClaw orch structured outputs schema compatibility fix result

## Root cause

The delegated structured output schema in `src/agents/pi-embedded-runner/structured-output.ts`
used this shape for the payload body:

```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "result": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": ["summary", "result"],
  "additionalProperties": false
}
```

That inner `result` node was an open object schema. Claude's structured outputs support for
`anthropic-messages` rejects `additionalProperties: true` on object schemas, so delegated child
runs could fail before the worker even produced an answer.

The orchestrator side also assumed the legacy envelope and primarily consumed `parsed.result`, so
switching to a closed schema required a matching reader change.

## Final envelope

The delegated structured output request now uses a closed, provider-compatible envelope:

```json
{
  "type": "object",
  "properties": {
    "ok": { "type": "boolean" },
    "summary": { "type": "string" },
    "result_json": { "type": "string" },
    "error_message": { "type": "string" }
  },
  "required": ["ok", "summary", "result_json", "error_message"],
  "additionalProperties": false
}
```

Operational contract:

- success: `ok=true`, `result_json` contains a JSON-encoded string, `error_message=""`
- failure: `ok=false`, `result_json` can be `"null"` or another inert JSON value, and
  `error_message` carries the delegated failure detail

## Consumption changes

Updated `src/agents/pi-embedded-runner/orchestrator.ts` to consume the new envelope while keeping
legacy compatibility:

- the delegated prompt now instructs the worker to return `ok`, `summary`, `result_json`, and
  `error_message`
- on success, the orchestrator tries `JSON.parse(result_json)` first
- if `result_json` is invalid JSON, the orchestrator falls back to the legacy `result` field when
  present, otherwise it preserves the raw `result_json` string
- if the envelope reports `ok=false`, the orchestrator now returns a standardized failure using the
  delegated `summary` and `error_message`
- legacy prompt-only / parser fallback remains intact for older `{"summary":...,"result":...}`
  outputs

## Files changed

- `src/agents/pi-embedded-runner/structured-output.ts`
- `src/agents/pi-embedded-runner/orchestrator.ts`
- `src/agents/pi-embedded-runner/structured-output.test.ts`
- `src/agents/pi-embedded-runner/orchestrator.test.ts`

## Validation

Formatted targeted files with:

```sh
pnpm format src/agents/pi-embedded-runner/structured-output.ts \
  src/agents/pi-embedded-runner/orchestrator.ts \
  src/agents/pi-embedded-runner/orchestrator.test.ts \
  src/agents/pi-embedded-runner/structured-output.test.ts
```

Ran targeted tests:

```sh
pnpm exec vitest run \
  src/agents/pi-embedded-runner/structured-output.test.ts \
  src/agents/pi-embedded-runner/orchestrator.test.ts \
  src/agents/pi-embedded-runner/run/attempt.test.ts
```

Result: 3 test files passed, 44 tests passed.

Coverage added/confirmed:

- schema no longer contains `additionalProperties: true`
- orchestrator parses `result_json`
- `ok=false` structured envelope is surfaced as a failure
- legacy `result` fallback still works
- invalid `result_json` preserves the raw value instead of breaking the run

## Git

To be filled after commit / push / merge.

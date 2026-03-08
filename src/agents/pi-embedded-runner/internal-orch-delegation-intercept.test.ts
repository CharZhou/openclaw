import "./run.overflow-compaction.mocks.shared.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddedPiAgent, buildDelegatedPayloadText } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedRunEmbeddedAttempt = vi.mocked(runEmbeddedAttempt);

describe("implicit internal orch delegation interception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("swallows the raw orch_delegate action and returns delegated plain-text result", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce({
      aborted: false,
      promptError: null,
      timedOut: false,
      timedOutDuringCompaction: false,
      sessionIdUsed: "test-session",
      assistantTexts: ['{"type":"orch_delegate","objective":"extract install steps"}'],
      lastAssistant: {
        usage: { input: 120, output: 40, total: 160 },
        stopReason: "end_turn",
      },
      attemptUsage: { input: 120, output: 40, total: 160 },
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
      internalOrchDelegation: {
        ok: true,
        summary: "done",
        result: "Install steps:\n1. pnpm install\n2. pnpm dev",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    expect(result.payloads).toEqual([
      {
        text: "Install steps:\n1. pnpm install\n2. pnpm dev",
      },
    ]);
    expect(result.payloads[0]?.text).not.toContain('"type":"orch_delegate"');
  });

  it("keeps object delegation results as JSON text", () => {
    expect(buildDelegatedPayloadText({ steps: ["pnpm install"] })).toBe(
      '{"steps":["pnpm install"]}',
    );
  });
});

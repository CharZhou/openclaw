import { describe, expect, it } from "vitest";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

describe("internal orch delegation result contract", () => {
  it("supports attaching internalOrchDelegation to attempt results", () => {
    const result: EmbeddedRunAttemptResult = {
      aborted: false,
      timedOut: false,
      timedOutDuringCompaction: false,
      promptError: null,
      sessionIdUsed: "test-session",
      assistantTexts: ['{"type":"orch_delegate","objective":"extract install steps"}'],
      toolMetas: [],
      lastAssistant: undefined,
      messagesSnapshot: [],
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
      internalOrchDelegation: {
        ok: true,
        summary: "done",
        result: { steps: ["a"] },
      },
    };

    expect(result.internalOrchDelegation).toEqual({
      ok: true,
      summary: "done",
      result: { steps: ["a"] },
    });
  });
});

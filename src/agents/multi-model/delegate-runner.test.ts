import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { DelegateRunInput } from "./types.js";

// Mock runEmbeddedPiAgent before importing delegate-runner
const mockRunEmbeddedPiAgent = vi.fn();
vi.mock("../pi-embedded-runner/run.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => mockRunEmbeddedPiAgent(...args),
}));

// Import after mock setup
const { executeDelegateRun } = await import("./delegate-runner.js");

function makeConfig(overrides?: Record<string, unknown>): OpenClawConfig {
  return {
    agents: {
      defaults: {
        models: {
          "anthropic/claude-haiku-4-5": { alias: "fast" },
          "anthropic/claude-sonnet-4-5": { alias: "main" },
          "anthropic/claude-opus-4-6": { alias: "deep" },
        },
        multiModel: {
          enabled: true,
          delegateTimeoutSeconds: 120,
          ...overrides,
        },
      },
    },
  } as unknown as OpenClawConfig;
}

function makeSuccessResult(text: string) {
  return {
    payloads: [{ text }],
    meta: {
      agentMeta: {
        usage: { input: 100, output: 50, total: 150 },
      },
    },
  };
}

function makeErrorResult(message: string) {
  return {
    payloads: [],
    meta: {
      error: { message },
      agentMeta: { usage: null },
    },
  };
}

describe("executeDelegateRun", () => {
  beforeEach(() => {
    mockRunEmbeddedPiAgent.mockClear();
  });

  it("calls runEmbeddedPiAgent with correct provider/model for role", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("Summary: test done"));

    const input: DelegateRunInput = {
      role: "research",
      task: "Search for relevant files",
    };

    const result = await executeDelegateRun({
      input,
      parentSessionKey: "agent:coder:discord:channel:123",
      config: makeConfig(),
      workspaceDir: "/tmp/test-workspace",
      agentDir: "/tmp/test-agent",
    });

    expect(result.status).toBe("ok");
    expect(result.role).toBe("research");
    expect(result.effectiveModel).toBe("anthropic/claude-haiku-4-5");
    expect(result.summary).toContain("Summary: test done");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify runEmbeddedPiAgent was called with correct params
    expect(mockRunEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.provider).toBe("anthropic");
    expect(callArgs.model).toBe("claude-haiku-4-5");
    expect(callArgs.thinkLevel).toBe("low"); // research default
    expect(callArgs.disableMessageTool).toBe(true);
    expect(callArgs.lane).toMatch(/^delegate:research$/);
  });

  it("allows model override via input", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    await executeDelegateRun({
      input: {
        role: "research",
        task: "test",
        model: "deep", // override from fast to deep
      },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.provider).toBe("anthropic");
    expect(callArgs.model).toBe("claude-opus-4-6");
  });

  it("allows explicit provider/model override", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    await executeDelegateRun({
      input: {
        role: "implement",
        task: "write code",
        model: "openai/gpt-5",
      },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.provider).toBe("openai");
    expect(callArgs.model).toBe("gpt-5");
  });

  it("returns error status when child errors", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeErrorResult("API key invalid"));

    const result = await executeDelegateRun({
      input: { role: "plan", task: "analyze" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("API key invalid");
  });

  it("returns error status when runEmbeddedPiAgent throws", async () => {
    mockRunEmbeddedPiAgent.mockRejectedValueOnce(new Error("Connection timeout"));

    const result = await executeDelegateRun({
      input: { role: "review", task: "review code" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("Connection timeout");
    expect(result.summary).toBe("");
  });

  it("truncates summary in brief mode", async () => {
    const longText = "A".repeat(5000);
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult(longText));

    const result = await executeDelegateRun({
      input: { role: "research", task: "scan", summaryMode: "brief" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result.summary.length).toBeLessThanOrEqual(2100); // 2000 + truncation notice
    expect(result.summary).toContain("[... truncated to brief mode limit]");
  });

  it("does not truncate short summaries", async () => {
    const shortText = "All good, nothing found.";
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult(shortText));

    const result = await executeDelegateRun({
      input: { role: "research", task: "scan" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result.summary).toBe(shortText);
  });

  it("uses thinking override from input", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    await executeDelegateRun({
      input: { role: "research", task: "test", thinking: "high" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.thinkLevel).toBe("high");
  });

  it("uses config timeout when input timeout not specified", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    await executeDelegateRun({
      input: { role: "research", task: "test" },
      parentSessionKey: "test:key",
      config: makeConfig({ delegateTimeoutSeconds: 300 }),
      workspaceDir: "/tmp/w",
    });

    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.timeoutMs).toBe(300_000);
  });

  it("uses input timeout override over config", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    await executeDelegateRun({
      input: { role: "research", task: "test", timeoutSeconds: 60 },
      parentSessionKey: "test:key",
      config: makeConfig({ delegateTimeoutSeconds: 300 }),
      workspaceDir: "/tmp/w",
    });

    const callArgs = mockRunEmbeddedPiAgent.mock.calls[0][0];
    expect(callArgs.timeoutMs).toBe(60_000);
  });

  it("includes usage info when available", async () => {
    mockRunEmbeddedPiAgent.mockResolvedValueOnce(makeSuccessResult("done"));

    const result = await executeDelegateRun({
      input: { role: "research", task: "test" },
      parentSessionKey: "test:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("generates unique child session keys", async () => {
    mockRunEmbeddedPiAgent
      .mockResolvedValueOnce(makeSuccessResult("done1"))
      .mockResolvedValueOnce(makeSuccessResult("done2"));

    const result1 = await executeDelegateRun({
      input: { role: "research", task: "test1" },
      parentSessionKey: "parent:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    const result2 = await executeDelegateRun({
      input: { role: "research", task: "test2" },
      parentSessionKey: "parent:key",
      config: makeConfig(),
      workspaceDir: "/tmp/w",
    });

    expect(result1.childSessionKey).not.toBe(result2.childSessionKey);
    expect(result1.childSessionKey).toContain("delegate:research");
    expect(result2.childSessionKey).toContain("delegate:research");
  });
});

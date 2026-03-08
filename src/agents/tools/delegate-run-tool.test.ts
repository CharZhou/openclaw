import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the delegate runner
const mockExecuteDelegateRun = vi.fn();
vi.mock("../multi-model/delegate-runner.js", () => ({
  executeDelegateRun: (...args: unknown[]) => mockExecuteDelegateRun(...args),
}));

const { createDelegateRunTool } = await import("./delegate-run-tool.js");

describe("createDelegateRunTool", () => {
  beforeEach(() => {
    mockExecuteDelegateRun.mockClear();
  });

  const baseOptions = {
    config: undefined,
    sessionKey: "test:session",
    workspaceDir: "/tmp/workspace",
    agentDir: "/tmp/agent",
  };

  it("creates a tool with correct metadata", () => {
    const tool = createDelegateRunTool(baseOptions);
    expect(tool.name).toBe("delegate_run");
    expect(tool.label).toBe("Delegate Run");
    expect(tool.description).toContain("delegate");
    expect(tool.parameters).toBeDefined();
  });

  it("executes delegate_run with valid params", async () => {
    mockExecuteDelegateRun.mockResolvedValueOnce({
      status: "ok",
      role: "research",
      childSessionKey: "test:delegate:research:abc",
      effectiveModel: "anthropic/claude-haiku-4-5",
      summary: "Found 3 relevant files",
      durationMs: 1500,
    });

    const tool = createDelegateRunTool(baseOptions);
    const result = await tool.execute("call-123", {
      role: "research",
      task: "Find all TypeScript files related to auth",
    });

    expect(mockExecuteDelegateRun).toHaveBeenCalledTimes(1);
    const callArgs = mockExecuteDelegateRun.mock.calls[0][0];
    expect(callArgs.input.role).toBe("research");
    expect(callArgs.input.task).toBe("Find all TypeScript files related to auth");
    expect(callArgs.parentSessionKey).toBe("test:session");

    // jsonResult returns { content: [{ type: "text", text: JSON.stringify(...) }] }
    expect(result).toBeDefined();
    const resultObj = result as { content: Array<{ type: string; text: string }> };
    expect(resultObj.content[0].type).toBe("text");
    const parsed = JSON.parse(resultObj.content[0].text);
    expect(parsed.status).toBe("ok");
    expect(parsed.summary).toBe("Found 3 relevant files");
  });

  it("passes string optional params through", async () => {
    mockExecuteDelegateRun.mockResolvedValueOnce({
      status: "ok",
      role: "implement",
      summary: "done",
      durationMs: 500,
    });

    const tool = createDelegateRunTool(baseOptions);
    await tool.execute("call-456", {
      role: "implement",
      task: "Add validation",
      context: "File: src/auth.ts",
      model: "deep",
      thinking: "high",
      summaryMode: "detailed",
      timeoutSeconds: 300,
    });

    const callArgs = mockExecuteDelegateRun.mock.calls[0][0];
    expect(callArgs.input.role).toBe("implement");
    expect(callArgs.input.task).toBe("Add validation");
    // readStringParam reads string params; context/model/thinking are strings
    expect(callArgs.input.context).toBe("File: src/auth.ts");
    expect(callArgs.input.model).toBe("deep");
    expect(callArgs.input.thinking).toBe("high");
    expect(callArgs.input.summaryMode).toBe("detailed");
    expect(callArgs.input.timeoutSeconds).toBe(300);
  });

  it("rejects invalid role", async () => {
    const tool = createDelegateRunTool(baseOptions);

    await expect(
      tool.execute("call-789", {
        role: "invalid_role",
        task: "test",
      }),
    ).rejects.toThrow(/Invalid role/);
  });

  it("passes workspace and agent options correctly", async () => {
    mockExecuteDelegateRun.mockResolvedValueOnce({
      status: "ok",
      summary: "done",
      durationMs: 100,
    });

    const tool = createDelegateRunTool({
      ...baseOptions,
      messageChannel: "discord",
      messageProvider: "discord",
      agentAccountId: "acc-123",
      runId: "run-456",
    });

    await tool.execute("call-000", {
      role: "plan",
      task: "design architecture",
    });

    const callArgs = mockExecuteDelegateRun.mock.calls[0][0];
    expect(callArgs.config).toBeUndefined();
    expect(callArgs.workspaceDir).toBe("/tmp/workspace");
    expect(callArgs.agentDir).toBe("/tmp/agent");
    expect(callArgs.messageChannel).toBe("discord");
    expect(callArgs.messageProvider).toBe("discord");
    expect(callArgs.agentAccountId).toBe("acc-123");
    expect(callArgs.parentRunId).toBe("run-456");
  });
});

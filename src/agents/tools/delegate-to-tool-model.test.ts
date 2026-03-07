import { describe, expect, it, vi } from "vitest";
import { createDelegateToToolModelTool } from "./delegate-to-tool-model.js";

describe("createDelegateToToolModelTool", () => {
  it("delegates execute payload to orchestrator and returns jsonResult details", async () => {
    const orchestrate = vi.fn(async () => ({
      ok: true as const,
      summary: "delegated",
      result: { done: true },
    }));
    const tool = createDelegateToToolModelTool({
      workspaceDir: process.cwd(),
      orchestrate,
    });

    const result = (await tool.execute?.("tool-call-1", {
      task: "collect facts",
      goal: "produce structured facts",
      return_format: "structured_json",
      success_criteria: "all facts included",
    })) as { details?: unknown };

    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate).toHaveBeenCalledWith(
      expect.objectContaining({
        args: {
          task: "collect facts",
          goal: "produce structured facts",
          return_format: "structured_json",
          success_criteria: "all facts included",
        },
      }),
    );
    expect(result.details).toEqual({
      ok: true,
      summary: "delegated",
      result: { done: true },
    });
  });

  it("rejects unsupported return_format", async () => {
    const tool = createDelegateToToolModelTool({
      workspaceDir: process.cwd(),
    });

    await expect(
      tool.execute?.("tool-call-2", {
        task: "collect facts",
        goal: "produce structured facts",
        return_format: "plain_text",
        success_criteria: "all facts included",
      }),
    ).rejects.toThrow("return_format must be structured_json");
  });
});

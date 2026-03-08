import { describe, expect, it } from "vitest";
import {
  buildDelegateArgsFromInternalAction,
  isOrchDelegateAction,
  parseInternalOrchAction,
} from "./internal-orch-action.js";

describe("internal orch action parsing", () => {
  it("parses valid raw JSON orch_delegate", () => {
    expect(
      parseInternalOrchAction(
        '{"type":"orch_delegate","objective":"read README and extract install steps"}',
      ),
    ).toEqual({
      type: "orch_delegate",
      objective: "read README and extract install steps",
    });
  });

  it("parses fenced JSON orch_delegate", () => {
    expect(
      parseInternalOrchAction('```json\n{"type":"orch_delegate","objective":"collect logs"}\n```'),
    ).toEqual({
      type: "orch_delegate",
      objective: "collect logs",
    });
  });

  it("does not mis-detect non orch_delegate JSON", () => {
    expect(parseInternalOrchAction('{"type":"something_else","objective":"x"}')).toBeNull();
  });

  it("does not mis-detect non JSON text", () => {
    expect(parseInternalOrchAction("hello world")).toBeNull();
  });

  it("validates action shape and builds delegate args", () => {
    expect(isOrchDelegateAction({ type: "orch_delegate", objective: "narrow task" })).toBe(true);
    expect(
      buildDelegateArgsFromInternalAction({ type: "orch_delegate", objective: "narrow task" }),
    ).toEqual({
      task: "narrow task",
      goal: "narrow task",
      return_format: "structured_json",
      success_criteria:
        "Complete only this bounded objective and return a structured JSON result for it: narrow task",
    });
  });
});

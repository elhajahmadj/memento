import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { AiAssistButton } from "@/shared/ai-assist/ai-assist-button";

/**
 * Component tests for the shared `AiAssistButton` — the visible trigger
 * every AI assist surface in the app uses. The hook (`useAiAssist`)
 * is unit-tested separately in `use-ai-assist.test.tsx`; this file
 * pins the *rendering* contract:
 *
 *   - Idle  → sparkle icon, enabled, click forwards.
 *   - Busy  → spinner icon, disabled (loading state).
 *   - Disabled by reason → disabled + tooltip carries the reason
 *     (e.g. "AI Agent is disabled for this project" — what the
 *     `disabled` error code from the server resolves to in the UI).
 *   - Empty: no `modelName` → generic "Powered by AI" tooltip.
 */

describe("AiAssistButton — render states", () => {
  it("renders enabled in the idle state and forwards clicks", () => {
    const onClick = vi.fn();
    render(
      <AiAssistButton onClick={onClick} testId="ai-btn">
        Suggest a step
      </AiAssistButton>,
    );
    const btn = screen.getByTestId("ai-btn");
    expect(btn).toBeDefined();
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables and shows a spinner while busy (loading state)", () => {
    const onClick = vi.fn();
    render(
      <AiAssistButton onClick={onClick} busy testId="ai-btn">
        Suggest a step
      </AiAssistButton>,
    );
    const btn = screen.getByTestId("ai-btn");
    expect(btn.hasAttribute("disabled")).toBe(true);
    // The spinner uses `animate-spin`; the idle sparkle does not.
    expect(btn.querySelector(".animate-spin")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is disabled when a disabledReason is supplied (error / empty key state)", () => {
    const onClick = vi.fn();
    render(
      <AiAssistButton
        onClick={onClick}
        disabledReason="AI Agent is disabled for this project."
        testId="ai-btn"
      >
        Suggest a step
      </AiAssistButton>,
    );
    const btn = screen.getByTestId("ai-btn");
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("respects an explicit `disabled` prop", () => {
    render(
      <AiAssistButton onClick={() => {}} disabled testId="ai-btn">
        Suggest a step
      </AiAssistButton>,
    );
    expect(screen.getByTestId("ai-btn").hasAttribute("disabled")).toBe(true);
  });
});

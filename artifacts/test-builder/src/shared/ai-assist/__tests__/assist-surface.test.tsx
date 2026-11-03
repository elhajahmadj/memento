import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useState, type JSX } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useAiAssist } from "@/shared/ai-assist/use-ai-assist";
import { AiAssistButton } from "@/shared/ai-assist/ai-assist-button";

/**
 * Surface-level integration test for the shared AI-assist kit.
 *
 * Task #17 introduced the kit (`useAiAssist` + `AiAssistButton`)
 * exactly so every future assist surface is a tiny consumer of the
 * pair — hook drives the network + error state, button renders the
 * trigger, parent writes the suggestion back to the underlying form
 * field. This file pins that integration as a representative
 * "assist surface": a sentence input that asks for the
 * `step-from-text` purpose, surfaces the four error states, and
 * writes the accepted suggestion's `selector` back into the destination
 * input.
 *
 * Each surface that follows in task #32 (step editor, assertion
 * editor, suggest-test-cases, explain-failure, summarize-suite,
 * generate-doc-page) is the same pattern with a different purpose
 * id + a different destination field — this test pins the shape they
 * all share.
 */

const ORIGINAL_FETCH = globalThis.fetch;

function StepAssistSurface(): JSX.Element {
  const [sentence, setSentence] = useState("Click the Sign In button");
  const [selector, setSelector] = useState("");
  const { run, busy, error, lastResult } = useAiAssist<
    { text: string },
    { verb: string; selector: string; explanation: string }
  >({ purpose: "step-from-text", toastOnError: false });

  return (
    <div>
      <input
        data-testid="sentence"
        value={sentence}
        onChange={(e) => setSentence(e.target.value)}
      />
      <input data-testid="selector" value={selector} readOnly />
      <AiAssistButton
        testId="ai-btn"
        busy={busy}
        disabledReason={
          error?.code === "disabled" ? error.message : undefined
        }
        onClick={async () => {
          const r = await run({ text: sentence });
          if (r) setSelector(r.output.selector);
        }}
      >
        Suggest selector
      </AiAssistButton>
      {error ? <div data-testid="error">{error.code}: {error.message}</div> : null}
      {lastResult ? (
        <div data-testid="explanation">{lastResult.output.explanation}</div>
      ) : null}
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("AI assist surface — happy path writes the suggestion back", () => {
  it("calls the dispatch endpoint, shows loading, then writes selector to the destination field", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((r) => (resolve = r));
    globalThis.fetch = vi.fn(() => fetchPromise) as unknown as typeof fetch;

    render(<StepAssistSurface />);
    expect(screen.getByTestId("selector").getAttribute("value")).toBe("");
    fireEvent.click(screen.getByTestId("ai-btn"));

    // Loading state — button disabled, spinner shown.
    expect(screen.getByTestId("ai-btn").hasAttribute("disabled")).toBe(true);

    resolve(
      new Response(
        JSON.stringify({
          output: {
            verb: "click",
            selector: "text=Sign In",
            explanation: "Click the Sign In button.",
          },
          model: "claude",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          purpose: "step-from-text",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await waitFor(() =>
      expect(screen.getByTestId("selector").getAttribute("value")).toBe(
        "text=Sign In",
      ),
    );
    expect(screen.getByTestId("explanation").textContent).toContain(
      "Click the Sign In",
    );
    // Empty state — no error rendered.
    expect(screen.queryByTestId("error")).toBeNull();
    // Button returns to enabled state.
    expect(screen.getByTestId("ai-btn").hasAttribute("disabled")).toBe(false);
  });
});

describe("AI assist surface — error states", () => {
  it("503 disabled disables the button and shows the friendly reason", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "AI Agent is disabled for this project.",
            code: "disabled",
            disabledReason: "PROJECT_DISABLED",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    render(<StepAssistSurface />);
    fireEvent.click(screen.getByTestId("ai-btn"));
    await waitFor(() => expect(screen.queryByTestId("error")).not.toBeNull());

    expect(screen.getByTestId("error").textContent).toContain("disabled");
    // Destination field stays untouched on failure.
    expect(screen.getByTestId("selector").getAttribute("value")).toBe("");
    // Button is now disabled by the resolved error reason.
    expect(screen.getByTestId("ai-btn").hasAttribute("disabled")).toBe(true);
  });

  it("502 provider surfaces the provider error to the surface", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "upstream 429",
            code: "provider",
            providerStatus: 429,
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    render(<StepAssistSurface />);
    fireEvent.click(screen.getByTestId("ai-btn"));
    await waitFor(() => expect(screen.queryByTestId("error")).not.toBeNull());
    expect(screen.getByTestId("error").textContent).toContain("provider");
    expect(screen.getByTestId("selector").getAttribute("value")).toBe("");
  });

  it("502 bad_output is surfaced without polluting the destination field", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "AI returned no parseable JSON.",
            code: "bad_output",
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    render(<StepAssistSurface />);
    fireEvent.click(screen.getByTestId("ai-btn"));
    await waitFor(() => expect(screen.queryByTestId("error")).not.toBeNull());
    expect(screen.getByTestId("error").textContent).toContain("bad_output");
    expect(screen.getByTestId("selector").getAttribute("value")).toBe("");
  });
});

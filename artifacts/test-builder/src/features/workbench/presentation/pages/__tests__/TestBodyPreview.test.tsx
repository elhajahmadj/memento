import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TestBodyPreview } from "../workbench";

function broadcast(lines: string[], indices?: Array<number | null>) {
  const lineActionIndices =
    indices ?? new Array(lines.length).fill(null);
  act(() => {
    window.dispatchEvent(
      new CustomEvent("recorder:body-preview", {
        detail: { lines, lineActionIndices },
      }),
    );
  });
}

describe("TestBodyPreview", () => {
  afterEach(() => {
    cleanup();
    broadcast([]);
  });

  it("renders the empty placeholder before any broadcast arrives", () => {
    render(<TestBodyPreview />);
    expect(
      screen.getByTestId("text-test-body-preview-empty"),
    ).toBeDefined();
  });

  it("renders every line from a bodyPreview broadcast verbatim", () => {
    render(<TestBodyPreview />);
    const lines = [
      "await Page.GotoAsync(\"https://example.com\");",
      "await Selectors.SubmitButton.ClickAsync();",
      "await Selectors.EmailField.FillAsync(\"hi@example.com\");",
    ];
    broadcast(lines);

    const panel = screen.getByTestId("panel-test-body-preview");
    const text = panel.textContent ?? "";
    for (const line of lines) {
      expect(text).toContain(line);
    }
    // Tighten: the rendered lines must appear in the exact broadcast order
    // so reordering/dropping/mangling lines is caught. We can't compare
    // textContent verbatim because react-syntax-highlighter is configured
    // with `showLineNumbers` (visually hidden but still in the DOM) so the
    // raw text contains numeric prefixes per line.
    const code = panel.querySelector("pre, code");
    expect(code).not.toBeNull();
    const positions = lines.map((line) =>
      (code!.textContent ?? "").indexOf(line),
    );
    for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(
      screen.queryByTestId("text-test-body-preview-empty"),
    ).toBeNull();
  });

  it("replaces stale lines when a later bodyPreview broadcast arrives", () => {
    render(<TestBodyPreview />);
    const stale = [
      "await Selectors.OldButton.ClickAsync();",
      "await Selectors.OldField.FillAsync(\"old\");",
    ];
    const fresh = [
      "await Page.GotoAsync(\"https://new.example.com\");",
      "await Selectors.NewButton.ClickAsync();",
    ];

    broadcast(stale);
    let text = screen.getByTestId("panel-test-body-preview").textContent ?? "";
    for (const line of stale) expect(text).toContain(line);

    broadcast(fresh);
    text = screen.getByTestId("panel-test-body-preview").textContent ?? "";
    for (const line of fresh) expect(text).toContain(line);
    for (const line of stale) expect(text).not.toContain(line);
  });
});

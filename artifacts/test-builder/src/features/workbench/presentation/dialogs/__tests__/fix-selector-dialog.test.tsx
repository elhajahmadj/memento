/**
 * Contract tests for the "Fix selector" workflow.
 *
 * The dialog itself is a thin three-tab shell over `<AiTab>`,
 * `<RepickTab>` and `<AdvancedTab>`. The dry-run-preview-then-apply
 * behavior against /api/selectors/heal — the one that has to keep
 * working byte-for-byte even when no AI key is configured — lives in
 * `<AdvancedTab>`. We exercise it here directly so the manual path's
 * contract is locked in independent of Radix tab navigation.
 *
 *   1. user types newSelector + clicks Preview  -> POST { dryRun: true }
 *      response renders both the recordings list and the on-disk
 *      Selectors-files list with their per-site replacement counts
 *   2. user clicks Apply                        -> POST { } (no dryRun)
 *      success toast + onApplied
 *
 * Failure UX:
 *   - 4xx/5xx response surfaces a toast.error
 *   - Preview button stays disabled until newSelector is non-empty AND
 *     differs from the broken selector
 *   - Apply stays disabled when the dry-run reports zero replacements
 *
 * A separate smoke test verifies the shell wires the three tabs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

// The dialog hides its "Fix with AI" tab for guest trial sessions, so
// it now reads the auth context. Default the whole suite to a regular
// (non-guest) user; the guest variant is asserted explicitly below.
const { isGuestMock } = vi.hoisted(() => ({ isGuestMock: vi.fn(() => false) }));
vi.mock("@/features/auth/presentation/role", () => ({
  useIsGuest: () => isGuestMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import { AdvancedTab } from "../fix-selector/advanced-tab";
import { AiTab } from "../fix-selector/ai-tab";
import { RepickTab } from "../fix-selector/repick-tab";
import { FixSelectorDialog } from "../fix-selector-dialog";
import type {
  AiAvailability,
  FixSelectorContext,
} from "../fix-selector/types";

const fetchMock = vi.fn();
let onApplied: () => void;

beforeEach(() => {
  onApplied = vi.fn();
  fetchMock.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const previewBody = {
  oldSelector: "[data-testid=submit]",
  newSelector: "[data-testid=login-submit]",
  totalReplacements: 3,
  recordingsChanged: 2,
  details: [
    {
      filePath: "Tests/A.cs",
      kind: "test",
      methodName: "A",
      replacements: 1,
      sites: [
        {
          location: "step 2",
          before: 'click selector="[data-testid=submit]"',
          after: 'click selector="[data-testid=login-submit]"',
        },
      ],
    },
    {
      filePath: "Tests/B.cs",
      kind: "test",
      methodName: "B",
      replacements: 2,
      sites: [
        {
          location: "step 1",
          before: 'click selector="[data-testid=submit]"',
          after: 'click selector="[data-testid=login-submit]"',
        },
        {
          location: "step 3 (wait)",
          before: 'wait waitSelector="[data-testid=submit]"',
          after: 'wait waitSelector="[data-testid=login-submit]"',
        },
      ],
    },
  ],
  filesChanged: 1,
  fileDetails: [
    {
      filePath: "PageObjects/Selectors/LoginSelectors.cs",
      keys: ["Submit"],
      replacements: 1,
      sites: [
        {
          location: "line 3",
          before:
            '    public static readonly string Submit = "[data-testid=submit]";',
          after:
            '        public static readonly string Submit = "[data-testid=login-submit]";',
        },
      ],
    },
  ],
};

describe("<AdvancedTab /> preview → apply happy path", () => {
  it("Preview renders both recordings + Selectors-files lists with per-site counts", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => previewBody,
    });
    render(
      <AdvancedTab
        oldSelector="[data-testid=submit]"
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "[data-testid=login-submit]" },
    });
    fireEvent.click(screen.getByTestId("button-preview-heal"));

    await waitFor(() => {
      expect(screen.getByTestId("heal-preview-recordings")).toBeTruthy();
      expect(screen.getByTestId("heal-preview-files")).toBeTruthy();
    });
    const recList = screen.getByTestId("heal-preview-recordings");
    expect(recList.textContent).toContain("Tests/A.cs");
    expect(recList.textContent).toContain("Tests/B.cs");
    expect(recList.textContent).toContain("2×");
    const fileList = screen.getByTestId("heal-preview-files");
    expect(fileList.textContent).toContain("LoginSelectors.cs");
    expect(fileList.textContent).toContain("Submit");

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ dryRun: true });
  });

  it("Apply POSTs without dryRun, toasts a count summary, and calls onApplied", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => previewBody })
      .mockResolvedValueOnce({ ok: true, json: async () => previewBody });
    render(
      <AdvancedTab
        oldSelector="[data-testid=submit]"
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "[data-testid=login-submit]" },
    });
    fireEvent.click(screen.getByTestId("button-preview-heal"));
    const apply = await screen.findByTestId("button-apply-heal");
    fireEvent.click(apply);

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringMatching(
          /Replaced 3 occurrences in 2 recordings.*1 occurrence in 1 selectors file/i,
        ),
      );
      expect(onApplied).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(init.body).dryRun).toBeUndefined();
  });
});

describe("<AdvancedTab /> grouped diff snippets + ack gate", () => {
  it("expanding a recording row reveals before/after snippets per site", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => previewBody,
    });
    render(
      <AdvancedTab
        oldSelector="[data-testid=submit]"
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "[data-testid=login-submit]" },
    });
    fireEvent.click(screen.getByTestId("button-preview-heal"));

    const toggle = await screen.findByTestId(
      "heal-preview-recording-1-toggle",
    );
    fireEvent.click(toggle);
    const sites = await screen.findByTestId("heal-preview-recording-1-sites");
    expect(sites.textContent).toContain("step 1");
    expect(sites.textContent).toContain("step 3 (wait)");
    expect(sites.textContent).toContain("[data-testid=submit]");
    expect(sites.textContent).toContain("[data-testid=login-submit]");
  });

  it("Apply unlocks once the user checks the acknowledgement box", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => previewBody,
    });
    const origDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 999;
      },
    });
    try {
      render(
        <AdvancedTab
          oldSelector="[data-testid=submit]"
          onApplied={onApplied}
        />,
      );
      fireEvent.change(screen.getByTestId("input-new-selector"), {
        target: { value: "[data-testid=login-submit]" },
      });
      fireEvent.click(screen.getByTestId("button-preview-heal"));

      const apply = (await screen.findByTestId(
        "button-apply-heal",
      )) as HTMLButtonElement;
      await waitFor(() => expect(apply).toBeTruthy());
      expect(apply.disabled).toBe(true);
      const ack = screen.getByTestId("checkbox-ack-heal");
      fireEvent.click(ack);
      await waitFor(() => expect(apply.disabled).toBe(false));
    } finally {
      if (origDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          origDescriptor,
        );
      }
    }
  });
});

describe("<AdvancedTab /> failure + disabled-state UX", () => {
  it("toasts an error when /api/selectors/heal returns non-OK on Preview", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: async () => "Server exploded",
    });
    render(
      <AdvancedTab
        oldSelector="[data-testid=submit]"
        onApplied={onApplied}
      />,
    );
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "#different" },
    });
    fireEvent.click(screen.getByTestId("button-preview-heal"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("Server exploded"),
      ),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("Preview is disabled until newSelector is non-empty AND differs from the broken selector", () => {
    render(
      <AdvancedTab oldSelector="#same" onApplied={onApplied} />,
    );
    const btn = screen.getByTestId(
      "button-preview-heal",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "#same" },
    });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "#new" },
    });
    expect(btn.disabled).toBe(false);
  });

  it("Apply is disabled when the dry-run reported zero replacements", async () => {
    const empty = {
      ...previewBody,
      totalReplacements: 0,
      details: [],
      fileDetails: [],
      filesChanged: 0,
      recordingsChanged: 0,
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => empty });
    render(
      <AdvancedTab oldSelector="#orig" onApplied={onApplied} />,
    );
    fireEvent.change(screen.getByTestId("input-new-selector"), {
      target: { value: "#new" },
    });
    fireEvent.click(screen.getByTestId("button-preview-heal"));
    const apply = (await screen.findByTestId(
      "button-apply-heal",
    )) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* AI tab — task #15                                                  */
/* ------------------------------------------------------------------ */

const AI_CONTEXT: FixSelectorContext = {
  selector: "[data-testid=submit]",
  actionDescription: "click submit",
  errorMessage: "Timed out waiting for selector",
  pageUrl: "https://example.com/login",
  priorSteps: ["goto /login"],
};

const AI_AVAILABLE: AiAvailability = {
  available: true,
  provider: "anthropic",
};

const AI_UNAVAILABLE: AiAvailability = {
  available: false,
  reason: "NO_API_KEY",
  message: "No AI provider API key is configured.",
  setupHref: "/tools/ai-agent",
};

const AI_SUGGEST_RESPONSE = {
  suggestedSelector: "[data-testid=login-submit]",
  confidence: "high" as const,
  explanation: "Use the more specific login-submit testid.",
  model: "claude-3-5-sonnet-20241022",
  provider: "anthropic",
  tokensIn: 100,
  tokensOut: 30,
};

describe("<AiTab /> availability + lifecycle", () => {
  it("no_key empty state renders setup link + manual fallbacks when probe says unavailable", async () => {
    const onSwitchTab = vi.fn();
    render(
      <AiTab
        context={AI_CONTEXT}
        availability={AI_UNAVAILABLE}
        onApplied={onApplied}
        onSwitchTab={onSwitchTab}
        onEditAdvanced={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("fix-selector-ai-no-key")).toBeTruthy(),
    );
    const link = screen.getByTestId("button-ai-setup-link").querySelector("a");
    expect(link?.getAttribute("href")).toBe("/tools/ai-agent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("button disabled with 'Checking AI availability…' while probe is in flight", () => {
    render(
      <AiTab
        context={AI_CONTEXT}
        availability={null}
        onApplied={onApplied}
        onSwitchTab={() => {}}
        onEditAdvanced={() => {}}
      />,
    );
    const btn = screen.getByTestId("button-ai-suggest") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Checking AI availability/i);
  });

  it("loading → suggested → preview → apply forwards AI metadata in apply body", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => AI_SUGGEST_RESPONSE }) // suggest
      .mockResolvedValueOnce({ ok: true, json: async () => previewBody })       // preview
      .mockResolvedValueOnce({ ok: true, json: async () => previewBody });      // apply
    const origDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 999;
      },
    });
    try {
      render(
        <AiTab
          context={AI_CONTEXT}
          availability={AI_AVAILABLE}
          onApplied={onApplied}
          onSwitchTab={() => {}}
          onEditAdvanced={() => {}}
        />,
      );

      fireEvent.click(screen.getByTestId("button-ai-suggest"));
      const result = await screen.findByTestId("fix-selector-ai-result");
      expect(result).toBeTruthy();
      expect(screen.getByTestId("ai-confidence").textContent).toMatch(/high/i);
      expect(screen.getByTestId("ai-explanation").textContent).toContain(
        "login-submit",
      );
      const edited = screen.getByTestId("input-ai-edited") as HTMLInputElement;
      expect(edited.value).toBe("[data-testid=login-submit]");

      const [, suggestInit] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(suggestInit.body)).toMatchObject({
        oldSelector: "[data-testid=submit]",
        actionDescription: "click submit",
        pageUrl: "https://example.com/login",
      });

      fireEvent.click(screen.getByTestId("button-ai-preview"));
      const ack = await screen.findByTestId("checkbox-ack-heal");
      fireEvent.click(ack);
      const apply = (await screen.findByTestId(
        "button-ai-apply",
      )) as HTMLButtonElement;
      await waitFor(() => expect(apply.disabled).toBe(false));
      fireEvent.click(apply);

      await waitFor(() => expect(onApplied).toHaveBeenCalled());
      expect(toastSuccess).toHaveBeenCalled();

      const [, applyInit] = fetchMock.mock.calls[2]!;
      const applyBody = JSON.parse(applyInit.body);
      expect(applyBody).toMatchObject({
        oldSelector: "[data-testid=submit]",
        newSelector: "[data-testid=login-submit]",
        via: "ai",
        aiProvider: "anthropic",
        aiModel: "claude-3-5-sonnet-20241022",
        aiConfidence: "high",
        aiTokensIn: 100,
        aiTokensOut: 30,
      });
      expect(applyBody.dryRun).toBeUndefined();
    } finally {
      if (origDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollHeight",
          origDescriptor,
        );
      }
    }
  });

  it("404 not_found from /ai-suggest flips into the no_key empty state (not error)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: "No AI provider API key is configured.",
        kind: "not_found",
      }),
    });
    render(
      <AiTab
        context={AI_CONTEXT}
        availability={AI_AVAILABLE}
        onApplied={onApplied}
        onSwitchTab={() => {}}
        onEditAdvanced={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-ai-suggest"));
    await waitFor(() =>
      expect(screen.getByTestId("fix-selector-ai-no-key")).toBeTruthy(),
    );
  });

  it("502 infrastructure error renders the error card with switch-to-manual button", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        error: "The AI provider failed (HTTP 503).",
        kind: "infrastructure",
      }),
    });
    const onSwitchTab = vi.fn();
    render(
      <AiTab
        context={AI_CONTEXT}
        availability={AI_AVAILABLE}
        onApplied={onApplied}
        onSwitchTab={onSwitchTab}
        onEditAdvanced={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-ai-suggest"));
    const err = await screen.findByTestId("fix-selector-ai-error");
    expect(err.textContent).toContain("AI provider failed");
    fireEvent.click(screen.getByTestId("button-ai-switch-repick"));
    expect(onSwitchTab).toHaveBeenCalledWith("repick");
  });

  it("Reject & try again re-fires /ai-suggest from the suggestion card", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => AI_SUGGEST_RESPONSE })
      .mockResolvedValueOnce({ ok: true, json: async () => AI_SUGGEST_RESPONSE });
    render(
      <AiTab
        context={AI_CONTEXT}
        availability={AI_AVAILABLE}
        onApplied={onApplied}
        onSwitchTab={() => {}}
        onEditAdvanced={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("button-ai-suggest"));
    await screen.findByTestId("fix-selector-ai-result");
    fireEvent.click(screen.getByTestId("button-ai-reject"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]![0]).toContain("/ai-suggest");
    expect(fetchMock.mock.calls[1]![0]).toContain("/ai-suggest");
  });
});

describe("<RepickTab /> idle state", () => {
  it("renders the Start re-pick CTA when the dialog opens on the Re-pick tab", () => {
    render(
      <RepickTab
        context={AI_CONTEXT}
        onApplied={onApplied}
        onSwitchTab={() => {}}
      />,
    );
    expect(screen.getByTestId("fix-selector-tab-repick")).toBeTruthy();
    expect(screen.getByTestId("button-repick-start")).toBeTruthy();
  });
});

describe("<FixSelectorDialog /> shell", () => {
  it("renders all three tabs and the broken selector header", () => {
    render(
      <FixSelectorDialog
        open={true}
        onOpenChange={() => {}}
        context={{ selector: "[data-testid=broken]" }}
      />,
    );
    expect(screen.getByTestId("tab-ai")).toBeTruthy();
    expect(screen.getByTestId("tab-repick")).toBeTruthy();
    expect(screen.getByTestId("tab-advanced")).toBeTruthy();
    expect(
      screen.getByText("[data-testid=broken]"),
    ).toBeTruthy();
  });

  it("returns null and renders nothing when context is null", () => {
    const { container } = render(
      <FixSelectorDialog
        open={true}
        onOpenChange={() => {}}
        context={null}
      />,
    );
    expect(container.querySelector("[data-testid=dialog-fix-selector]")).toBeNull();
  });

  it("drops the AI tab for a guest and defaults to Re-pick", () => {
    isGuestMock.mockReturnValue(true);
    try {
      render(
        <FixSelectorDialog
          open={true}
          onOpenChange={() => {}}
          context={{ selector: "[data-testid=broken]" }}
          initialTab="ai"
        />,
      );
      // Guests have no AI features; `/selectors/heal/ai-suggest` is
      // closed to them server-side, so the tab must not be offered
      // even when a caller explicitly asks for it.
      expect(screen.queryByTestId("tab-ai")).toBeNull();
      // The deterministic paths remain.
      expect(screen.getByTestId("tab-repick")).toBeTruthy();
      expect(screen.getByTestId("tab-advanced")).toBeTruthy();
    } finally {
      isGuestMock.mockReturnValue(false);
    }
  });
});

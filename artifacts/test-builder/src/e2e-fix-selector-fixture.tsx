import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { FixSelectorDialog } from "./features/workbench/presentation/dialogs/fix-selector-dialog";
import type { FixSelectorContext } from "./features/workbench/presentation/dialogs/fix-selector/types";

/**
 * Standalone fixture page used by `e2e/fix-selector-ai.spec.ts`.
 * Renders the real `FixSelectorDialog` with a fixed failing-step
 * context, so the Playwright spec can drive the AI → preview → apply
 * flow with `page.route()`-mocked endpoints without spinning up a
 * full recorder + project. The dialog itself is identical to the one
 * mounted by the workbench validation row.
 *
 * StrictMode is intentionally skipped (same reasoning as the
 * RecordingCanvas fixture): double-invoked effects in dev mode can
 * trip the AI tab's availability probe twice in a row, which is a
 * test-environment artifact rather than real production behavior.
 */

const FIXED_CONTEXT: FixSelectorContext = {
  selector: "[data-testid=submit]",
  actionDescription: "click the submit button",
  errorMessage: "Timed out 5000ms waiting for [data-testid=submit]",
  pageUrl: "https://example.com/login",
  priorSteps: ["goto https://example.com/login", "fill #user with 'demo'"],
};

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function FixSelectorFixture() {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(0);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 18 }}>Fix Selector — E2E fixture</h1>
      <p data-testid="fixture-applied-count">applied={applied}</p>
      <button
        type="button"
        data-testid="fixture-open-dialog"
        onClick={() => setOpen(true)}
        style={{
          padding: "8px 12px",
          border: "1px solid #999",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        Open Fix selector dialog
      </button>
      <FixSelectorDialog
        open={open}
        onOpenChange={setOpen}
        context={FIXED_CONTEXT}
        onApplied={() => setApplied((n) => n + 1)}
        initialTab="ai"
      />
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <QueryClientProvider client={qc}>
      <FixSelectorFixture />
    </QueryClientProvider>,
  );
}

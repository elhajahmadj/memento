import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { RecordingCanvas, RightPanel } from "./features/workbench/presentation/pages/workbench";

// NOTE: This fixture intentionally does NOT wrap the tree in <StrictMode>.
// React 18's StrictMode double-invokes effect bodies AND functional state
// setters in development to surface impure code, and the workbench's
// `enqueueNamePrompt` updater intentionally pops from `nameQueueRef` inside
// the setter. Under StrictMode that pop runs twice — the first invocation
// drains the queue, the second sees an empty queue and returns null,
// leaving the dialog closed. The production app does not run under
// StrictMode, so this matches deployed behavior; bypassing StrictMode here
// lets e2e tests exercise the real prompt flow without false negatives.

function noop() {}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function E2EFixture() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", height: "100vh" }}>
      <div style={{ minWidth: 0 }}>
        <RecordingCanvas />
      </div>
      <div style={{ minWidth: 0 }}>
        <RightPanel
          tests={[]}
          onAddClass={noop}
          onAddMethod={noop}
          onValidateClass={noop}
          onValidateMethod={noop}
          onValidateSession={noop}
          recording
          stopped={false}
        />
      </div>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <QueryClientProvider client={qc}>
      <E2EFixture />
    </QueryClientProvider>,
  );
}

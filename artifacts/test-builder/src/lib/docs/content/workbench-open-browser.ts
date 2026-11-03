import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-open-browser",
    heading: "Workbench — Open Browser (hand-prep before recording)",
    intro:
      "The 'Open Browser' entry in the Workbench toolbar's Actions menu launches a headless Chromium session at a URL you choose, without starting a recording. Use it when the test you want to record begins from a state the recorder cannot reach on its own — a logged-in session, a multi-step wizard, a manually accepted cookie banner — so you can hand-prep that state and then attach a recording on top of it. The URL you type is intentionally NOT saved to the project's named-URL store (`appsettings.json` for C#, `.env` for Python / Node.js / Java), and the attach step skips the per-suite `goto(...)` header line, so the suite's stored start URL stays whatever it already was.",
    walkthrough: [
      "Open a project so the Workbench toolbar is visible (the menu only appears when a project is loaded).",
      "Open the Actions dropdown in the top-right toolbar and pick 'Open Browser'.",
      "In the dialog, type the URL you want to land on (defaults to https://example.com) and click 'Open'. A headless Chromium session opens at that URL; the toolbar swaps Start Recording for the pre-attach pair 'Start Recording' + 'Close Browser', and Build with AI is disabled with the tooltip 'Close the open browser session first.'.",
      "Hand-prep the browser state — sign in, dismiss banners, navigate to the page where the recording should begin.",
      "Click 'Start Recording'. The Start Recording dialog opens in attach mode: the Base URL block and Browser size block are hidden (the URL and viewport are pinned by the open session), Create new test suite is disabled, and the BeforeEach / OneTimeSetUp targets are unavailable — attach is restricted to adding a new [Test] method to an existing suite.",
      "Pick the existing suite and a method name, then click Start Recording. The recorder attaches to the live browser at its current state; from here the flow is identical to the normal Start Recording flow.",
      "Save the recording the same way you would any other (admins save directly; users go through 'Request SDET approval'). The named-URL store file on disk stays byte-identical — no upsertNamedUrl on start, no regenerateTestConfig on finalize.",
      "If you change your mind before attaching, click 'Close Browser'. The pre-attach session is torn down, the toolbar returns to its normal idle state, and Build with AI re-enables.",
    ],
    fields: [
      {
        name: "Actions menu → Open Browser",
        description:
          "`data-testid=\"button-open-browser\"`. Greyed out (with a tooltip explaining why) when a recording is already active, when an open-browser session is already live, or when another user owns the global recording slot — only one open-browser session can exist at a time, just like the regular recorder.",
      },
      {
        name: "URL input",
        description:
          "`data-testid=\"input-open-browser-url\"`. Required. The Chromium session navigates to this URL on open. The URL is intentionally not written to the project's named-URL store — it is per-session state, not per-project configuration.",
      },
      {
        name: "Open button",
        description:
          "`data-testid=\"button-open-browser-confirm\"`. Calls `POST /api/recording/open-browser`. A single-flight guard rejects a second `/open-browser` while the first is still alive (HTTP 400).",
      },
      {
        name: "Toolbar — Start Recording (attach)",
        description:
          "`data-testid=\"button-start-recording-attach\"`. Replaces the normal Start Recording button while a pre-attach session is live. Opens the Start Recording dialog in attach mode with the locks described below.",
      },
      {
        name: "Toolbar — Close Browser",
        description:
          "`data-testid=\"button-close-open-browser\"`. Calls `POST /api/recording/cancel-open-browser`, which tears the pre-attach session down. Idempotent — a second cancel returns `{canceled:false}` instead of erroring.",
      },
      {
        name: "Attach-mode dialog locks",
        description:
          "While `note-attach-open-browser` is visible, the dialog hides the Base URL block (`section-base-url`) and the Browser size block (`section-browser-size`), disables the 'Create new test suite' radio, and disables the BeforeEach / OneTimeSetUp targets. The server enforces the same constraints — `POST /api/recording/attach-to-open-browser` returns HTTP 400 if you try to pass `suiteMode:'new'`, a non-`testMethod` `target`, a `startUrl`, a `urlName`, or a `newTestClassName`.",
      },
      {
        name: "Build with AI is parked",
        description:
          "While a pre-attach session is live, the toolbar's `button-test-with-ai` is disabled with the tooltip 'Close the open browser session first.'. The Open Browser flow and Build with AI cannot share the global Chromium slot.",
      },
      {
        name: "Named-URL store stays byte-identical",
        description:
          "Both the start path and the finalize path skip the named-URL store: `/open-browser` does not call `upsertNamedUrl` and the open-browser-originated finalize skips `regenerateTestConfig`. As a result `appsettings.json` (C#) and `.env` (Python / Node.js / Java) are byte-identical before and after the flow — recordings layered on top of an open browser cannot rewrite the suite's stored start URL.",
      },
    ],
  },
];

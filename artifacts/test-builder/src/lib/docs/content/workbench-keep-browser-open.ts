import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-keep-browser-open",
    heading: "Workbench — Keep browser open between recordings",
    intro:
      "The Start Recording dialog now ends with a 'Keep browser open after stop recording button is clicked' checkbox, sitting directly under the 'Ignore this test' block. When ticked, clicking Stop Recording does not tear the Chromium session down — the browser stays parked on whatever page the recording left off on. Saving still finalizes the test the same way (page-object classes, selector dictionaries, and the test method are written to disk), and the session is then recycled back into the open-browser pre-attach state. The next time you click Start Recording the dialog opens in attach mode so you can add another [Test] method into the same suite without losing the page state you spent the previous recording reaching.",
    walkthrough: [
      "Open the Start Recording dialog from the Workbench toolbar.",
      "Fill in the dialog as normal (suite target, method name, base URL, viewport, optional category, optional ignore reason).",
      "Tick 'Keep browser open after stop recording button is clicked' at the bottom of the dialog (directly under 'Ignore this test'). The checkbox starts unchecked every time the dialog opens — it is a per-recording opt-in, not a saved preference.",
      "Click Start Recording and drive the browser as usual.",
      "Click Stop Recording. The captured actions stay in the workbench so you can review / edit / add assertions, and the browser is left running in the background on the page the recording stopped on.",
      "Save (or, as a User, 'Request SDET approval'). memento finalizes the test files on disk, then transitions the session back into the open-browser pre-attach state.",
      "Click Start Recording again. The dialog opens in attach mode — Base URL and Browser size are hidden, 'Create new test suite' is disabled, and only the New [Test] method target is available. Pick the same suite, type a new method name, and continue from the same page state without re-running the previous test.",
      "When you're done with the suite, click Close Browser (the pre-attach toolbar swap) to tear the session down, or discard from the recorded-actions feed.",
    ],
    fields: [
      {
        name: "Keep browser open after stop recording button is clicked",
        description:
          "`data-testid=\"checkbox-keep-browser-open\"`. Optional, defaults to unchecked every time the Start Recording dialog opens. When ticked, Stop Recording leaves the Chromium session alive (the recording phase becomes `stopped` with the browser still on screen), and a successful Save recycles the session back into the open-browser pre-attach state so the next Start Recording opens the dialog in attach mode. The first screenshot above shows the Start Recording dialog scrolled to the new `section-keep-browser-open` block with the checkbox unchecked.",
      },
      {
        name: "Attach-mode dialog (second screenshot)",
        description:
          "The second screenshot above shows the same dialog re-opened in attach-to-open-browser mode after a kept-open Save. The amber-bordered `note-attach-open-browser` banner is visible at the top, the Base URL and Browser size blocks are hidden, the 'Create new test suite' radio is disabled, and only the New [Test] method target is selectable — exactly the locked Suite + Target controls described above, captured against the live UI.",
      },
      {
        name: "Stop → Save → re-start loop",
        description:
          "After Save runs, the same browser stays parked on the page the recording left off on. Click Start Recording again and the dialog opens in attach mode — `section-base-url` and `section-browser-size` are hidden, the 'Create new test suite' radio is disabled, and only the New [Test] method target is available. The newly recorded method lands in the same suite without launching a fresh Chromium or re-running the previous test to reach the same page state.",
      },
      {
        name: "Active-session warning",
        description:
          "If a kept-open browser is already alive (either in the `stopped` phase or recycled back to pre-attach) and you open a fresh Start Recording dialog instead of attaching, the dialog renders an amber `warning-keep-browser-open-active` banner: 'A previous recording left the browser open. Starting a fresh recording here will discard that live browser. To add another [Test] into the same suite, cancel this dialog and use the attach-to-open-browser flow instead.'",
      },
      {
        name: "Limitations",
        description:
          "Only one Chromium session is alive at a time — the global recording slot is shared with the rest of the recorder and with the Open Browser pre-attach flow, so a second user / project can't record while a kept-open session is parked. The checkbox is a per-recording opt-in: each time the Start Recording dialog opens it starts unchecked. Discarding the stopped recording (instead of saving) closes the browser the same way a normal Stop would — Keep-browser-open only survives a successful Save. Closing the workbench tab or signing out also tears the parked browser down.",
      },
    ],
  },
];

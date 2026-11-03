import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the per-row step-edit toolbar added in task
 * 24 (move up/down, duplicate, insert assertion before, edit recorded
 * value, delete). Each toolbar button dispatches a
 * `recorder:request-*` custom event that the RecordingCanvas forwards
 * over the WebSocket as a server-bound message; we drive the real
 * workbench in a headless Chromium against the e2e fixture page,
 * snapshot the outgoing WS messages with `__fakeWS__.messages()`,
 * and then play back the server's `feedReset` + `bodyPreview`
 * responses to prove the feed and the live code preview both refresh.
 */

interface SentMessage {
  raw: string;
  parsed: Record<string, unknown>;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto("/e2e-fixture.html");
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __fakeWS__?: unknown }).__fakeWS__),
  );
  await page.evaluate(() => {
    (
      window as unknown as { __fakeWS__: { open: () => void } }
    ).__fakeWS__.open();
  });
}

async function emit(page: Page, message: unknown): Promise<void> {
  await page.evaluate((m) => {
    (
      window as unknown as { __fakeWS__: { emit: (msg: unknown) => void } }
    ).__fakeWS__.emit(m);
  }, message);
}

async function readSent(page: Page): Promise<SentMessage[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __fakeWS__: { messages: () => SentMessage[] };
        }
      ).__fakeWS__.messages(),
  );
}

/**
 * Seed the actions feed with three synthetic recorded actions by
 * replaying server `action` broadcasts. Mirrors what the real
 * recorder would send after the user clicks → fills → clicks.
 */
async function seedFeed(page: Page): Promise<void> {
  // Intentionally omit `suggestedMethodName`: when present, the
  // workbench enqueues a "name this method" dialog after every
  // non-navigate action with an index, which would block toolbar
  // clicks behind a modal overlay. The toolbar buttons under test
  // don't depend on the row having a method name yet, so skipping
  // the name prompt is safe and isolates this spec to step-edit.
  const actions = [
    { index: 0, action: { type: "click", selector: "#login" } },
    {
      index: 1,
      action: { type: "fill", selector: "#email", value: "ada@example.com" },
    },
    { index: 2, action: { type: "click", selector: "#submit" } },
  ];
  for (const a of actions) {
    await emit(page, { type: "action", ...a });
  }
  // Wait for the third row to render before any of the toolbar
  // buttons are clicked, otherwise the disable/enable state of the
  // move-down button is racy.
  await expect(page.getByTestId("action-feed-item-2")).toBeVisible();
}

/**
 * Filter the outgoing-message log for the most recent message of a
 * given type. The fake WS records every send, so newer attempts
 * shadow earlier ones from previous test steps.
 */
function lastOfType(
  sent: SentMessage[],
  type: string,
): Record<string, unknown> | null {
  for (let i = sent.length - 1; i >= 0; i--) {
    const m = sent[i];
    if (m && m.parsed.type === type) return m.parsed;
  }
  return null;
}

test.describe("actions feed step-edit toolbar", () => {
  test("move/duplicate/insert/edit/delete each emit the expected WS message and refresh both feed + preview", async ({
    page,
  }) => {
    await openFixture(page);
    await seedFeed(page);

    // ---- Move down ------------------------------------------------
    // Click "move down" on row 0; the canvas should forward
    // `move-action` with `direction: "down"` and the row index.
    await page.getByTestId("button-move-down-action-0").click();
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "move-action").length;
      })
      .toBe(1);
    {
      const msg = lastOfType(await readSent(page), "move-action");
      expect(msg?.index).toBe(0);
      expect(msg?.direction).toBe("down");
    }

    // ---- Move up --------------------------------------------------
    // Click "move up" on row 2 (the original third row, which the
    // server may have just shifted upwards — the index sent is the
    // currently-visible row's index).
    await page.getByTestId("button-move-up-action-2").click();
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "move-action").length;
      })
      .toBe(2);
    {
      const msg = lastOfType(await readSent(page), "move-action");
      expect(msg?.index).toBe(2);
      expect(msg?.direction).toBe("up");
    }

    // ---- Duplicate -----------------------------------------------
    await page.getByTestId("button-duplicate-action-1").click();
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "duplicate-action").length;
      })
      .toBe(1);
    {
      const msg = lastOfType(await readSent(page), "duplicate-action");
      expect(msg?.index).toBe(1);
    }

    // ---- Insert assertion before ---------------------------------
    // Drive the full insert-before flow end to end: the button opens
    // the global add-assertion dialog with an `insertBeforeIndex`
    // hint pre-seeded, the user picks a kind + selector and submits,
    // and the canvas forwards an `add-assertion` WS message that
    // *carries* the hint so the server splices the new step at the
    // right position. Probing only "dialog opened" would miss a
    // regression where the hint is dropped on submit.
    await page.getByTestId("button-insert-before-action-1").click();
    const assertDialog = page.getByTestId("dialog-add-assertion");
    await expect(assertDialog).toBeVisible();
    // Pick element-visible — the simplest kind that needs only a
    // selector, so the dialog's submit button enables without any
    // text/url/value typing.
    await page.getByTestId("radio-assert-element-visible").click();
    await page.getByTestId("input-assert-selector").fill("#header");
    const addBtn = page.getByTestId("button-assertion-add");
    await expect(addBtn).toBeEnabled();
    await addBtn.click();
    await expect(assertDialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "add-assertion").length;
      })
      .toBe(1);
    {
      const msg = lastOfType(await readSent(page), "add-assertion");
      expect(msg?.assertKind).toBe("element-visible");
      expect(msg?.selector).toBe("#header");
      // The critical contract: the outbound message must carry the
      // insertBeforeIndex from the row we clicked the toolbar on.
      expect(msg?.insertBeforeIndex).toBe(1);
    }

    // ---- Edit recorded value -------------------------------------
    // The pencil only renders on rows the workbench considers
    // editable (fill/navigate/select/check/assert with a value-shape
    // assertion). The fill row at index 1 qualifies — open the
    // dialog, change the value, save, and confirm the
    // `edit-action-value` WS message carries the new payload.
    await page.getByTestId("button-edit-value-action-1").click();
    const editDialog = page.getByTestId("dialog-edit-action-value");
    await expect(editDialog).toBeVisible();
    const input = page.getByTestId("input-edit-action-value");
    await input.fill("grace@example.com");
    await page.getByTestId("button-edit-action-save").click();
    await expect(editDialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "edit-action-value").length;
      })
      .toBe(1);
    {
      const msg = lastOfType(await readSent(page), "edit-action-value");
      expect(msg?.index).toBe(1);
      // The dialog dispatches the edit detail directly; the value
      // field name depends on the row's editable shape — `fill`
      // actions edit `value`.
      expect(msg?.value).toBe("grace@example.com");
    }

    // ---- Delete --------------------------------------------------
    await page.getByTestId("button-delete-action-2").click();
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "delete-action").length;
      })
      .toBeGreaterThanOrEqual(1);
    {
      const msg = lastOfType(await readSent(page), "delete-action");
      expect(msg?.index).toBe(2);
    }

    // ---- Server replays feedReset → feed rebuilds ----------------
    // After any structural mutation the server publishes a fresh
    // snapshot of the visible rows. Push one with a single row to
    // prove the ActionsFeed listens for it and rebuilds the list
    // from scratch (rather than appending).
    await emit(page, {
      type: "feedReset",
      actions: [
        {
          index: 0,
          suggestedMethodName: "ClickLoginButton",
          action: { type: "click", selector: "#login" },
        },
      ],
    });
    await expect(page.getByTestId("action-feed-item-0")).toBeVisible();
    // The previous rows must be gone — feedReset replaces, not merges.
    await expect(page.getByTestId("action-feed-item-1")).toHaveCount(0);
    await expect(page.getByTestId("action-feed-item-2")).toHaveCount(0);

    // ---- Server replays bodyPreview → live preview refreshes ----
    // The TestBodyPreview panel renders nothing until a bodyPreview
    // arrives. Push one matching the single-row feed snapshot above
    // and assert the code panel surfaces the new line.
    await emit(page, {
      type: "bodyPreview",
      lines: ["await Page.Locator(\"#login\").ClickAsync();"],
      lineActionIndices: [0],
    });
    const codePanel = page.getByTestId("code-test-body-preview");
    await expect(codePanel).toBeVisible();
    await expect(codePanel).toContainText('Page.Locator("#login")');
  });
});

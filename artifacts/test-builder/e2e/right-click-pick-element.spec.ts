import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end coverage for the right-click "Assert text on this element"
 * flow on the live recording canvas. Drives the real workbench
 * components (`RecordingCanvas` + `RightPanel`) in a headless Chromium
 * via a tiny fixture page (`e2e-fixture.html`), with the recorder
 * WebSocket replaced by a page-side fake (`window.__fakeWS__`) so the
 * spec can play the role of the api-server.
 */

interface SentMessage {
  raw: string;
  parsed: Record<string, unknown>;
}

async function openFixture(page: Page): Promise<void> {
  await page.goto("/e2e-fixture.html");
  // Wait until the fixture has installed the WebSocket fake AND the
  // RecordingCanvas effect has constructed its socket.
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __fakeWS__?: unknown }).__fakeWS__,
      ),
  );
  await page.evaluate(() => {
    (window as unknown as { __fakeWS__: { open: () => void } }).__fakeWS__.open();
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

async function emitFrame(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await emit(page, {
    type: "frame",
    width,
    height,
    // 1×1 transparent PNG. The browser doesn't need to decode it for
    // the test — only the presence of the frame gates the <img>
    // trigger that owns the right-click handler.
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  });
}

test.describe("right-click pick → assertion dialog flow", () => {
  test("right-click → pick → server pickElementResult → dialog opens prefilled → confirm → assertion appears in feed", async ({
    page,
  }) => {
    await openFixture(page);

    // The canvas only renders its right-clickable image after the
    // first frame; without a frame there's nothing to right-click.
    await emitFrame(page, 800, 600);

    const canvas = page.getByTestId("recording-canvas");
    await expect(canvas).toBeVisible();

    // Right-click the visible canvas — Radix opens its real context
    // menu, and the canvas's own onContextMenu records the frame-space
    // pick coordinates from the click point.
    await canvas.click({ button: "right" });

    const pickItem = page.getByTestId("menuitem-assert-text-here");
    await expect(pickItem).toBeVisible();
    await pickItem.click();

    // Exactly one pick-element message went out, carrying numeric
    // coordinates resolved from the right-click on the canvas.
    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "pick-element").length;
      })
      .toBe(1);

    const sentAfterPick = await readSent(page);
    const pickMsg = sentAfterPick.find(
      (m) => m.parsed.type === "pick-element",
    );
    expect(typeof pickMsg?.parsed.x).toBe("number");
    expect(typeof pickMsg?.parsed.y).toBe("number");

    // The dialog must not be open yet — it only opens once the server
    // resolves the selector + visible text and the canvas forwards the
    // result through the `recorder:assert-prefill` event bus.
    await expect(page.getByTestId("dialog-add-assertion")).toHaveCount(0);

    // Server resolves the element under the click and ships back the
    // selector + visible text. The dialog should open with both
    // fields seeded.
    await emit(page, {
      type: "pickElementResult",
      selector: "#welcome-banner",
      strategy: "ById",
      text: "Welcome back, Ada",
    });

    const dialog = page.getByTestId("dialog-add-assertion");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByTestId("radio-assert-element-has-text"),
    ).toHaveAttribute("data-state", "checked");
    await expect(page.getByTestId("input-assert-selector")).toHaveValue(
      "#welcome-banner",
    );
    await expect(page.getByTestId("input-assert-text")).toHaveValue(
      "Welcome back, Ada",
    );

    // Confirm. The dialog dispatches `recorder:request-add-assertion`,
    // which the canvas forwards over the (fake) WS as `add-assertion`.
    const addBtn = page.getByTestId("button-assertion-add");
    await expect(addBtn).toBeEnabled();
    await addBtn.click();

    await expect
      .poll(async () => {
        const sent = await readSent(page);
        return sent.filter((m) => m.parsed.type === "add-assertion").length;
      })
      .toBe(1);

    const sentAfterAdd = await readSent(page);
    const addMsg = sentAfterAdd.find(
      (m) => m.parsed.type === "add-assertion",
    );
    expect(addMsg?.parsed.assertKind).toBe("element-has-text");
    expect(addMsg?.parsed.selector).toBe("#welcome-banner");
    expect(addMsg?.parsed.assertText).toBe("Welcome back, Ada");

    // Dialog closes after submit.
    await expect(page.getByTestId("dialog-add-assertion")).toHaveCount(0);

    // Server appends the assertion and broadcasts the new action; the
    // ActionsFeed surfaces a row carrying the same selector and text.
    await emit(page, {
      type: "action",
      index: 0,
      suggestedMethodName: "AssertText1",
      action: {
        type: "assert",
        assertKind: "element-has-text",
        selector: "#welcome-banner",
        assertText: "Welcome back, Ada",
      },
    });

    const feedRow = page.getByTestId("action-feed-item-0");
    await expect(feedRow).toBeVisible();
    await expect(feedRow).toContainText("#welcome-banner");
    await expect(feedRow).toContainText("Welcome back, Ada");
  });
});

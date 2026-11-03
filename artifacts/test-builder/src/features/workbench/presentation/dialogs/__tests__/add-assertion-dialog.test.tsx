/**
 * RTL specs for <AddAssertionDialog />. Covers the original nine
 * assertion kinds (each dispatches a `recorder:request-add-assertion`
 * event with a kind-specific detail payload) plus the Tier 3 a11y and
 * visual-baseline branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import { AddAssertionDialog } from "../add-assertion-dialog";

function captureEvent(name: string): { calls: CustomEvent[]; remove: () => void } {
  const calls: CustomEvent[] = [];
  const handler = (e: Event) => {
    calls.push(e as CustomEvent);
  };
  window.addEventListener(name, handler as EventListener);
  return {
    calls,
    remove: () => window.removeEventListener(name, handler as EventListener),
  };
}

let onOpenChange: ((v: boolean) => void) & ReturnType<typeof vi.fn>;

interface AssertionDetail {
  assertKind: string;
  axeImpactLevel?: string;
  visualName?: string;
  visualThreshold?: number;
  insertBeforeIndex?: number;
}

let captured: AssertionDetail[] = [];
const listener = (e: Event) => {
  captured.push((e as CustomEvent<AssertionDetail>).detail);
};

beforeEach(() => {
  onOpenChange = vi.fn() as unknown as typeof onOpenChange;
  captured = [];
  window.addEventListener("recorder:request-add-assertion", listener as EventListener);
});

afterEach(() => {
  window.removeEventListener("recorder:request-add-assertion", listener as EventListener);
  cleanup();
});

describe("<AddAssertionDialog /> emits recorder:request-add-assertion with the right payload per kind", () => {
  it("element-visible: { assertKind, selector } and closes the dialog on Add", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-element-visible"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "#hello" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "element-visible",
      selector: "#hello",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cap.remove();
  });

  it("element-hidden: { assertKind, selector }", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-element-hidden"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "#bye" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "element-hidden",
      selector: "#bye",
    });
    cap.remove();
  });

  it("element-count-equals: { assertKind, selector, assertCount } as a number", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-element-count-equals"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: ".row" },
    });
    fireEvent.change(screen.getByTestId("input-assert-count"), {
      target: { value: "3" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "element-count-equals",
      selector: ".row",
      assertCount: 3,
    });
    cap.remove();
  });

  it("attribute-equals: { assertKind, selector, assertAttribute, assertAttrValue }", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-attribute-equals"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "a.docs" },
    });
    fireEvent.change(screen.getByTestId("input-assert-attribute"), {
      target: { value: "href" },
    });
    fireEvent.change(screen.getByTestId("input-assert-attr-value"), {
      target: { value: "/docs" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "attribute-equals",
      selector: "a.docs",
      assertAttribute: "href",
      assertAttrValue: "/docs",
    });
    cap.remove();
  });

  it("value-equals: { assertKind, selector, assertValue }", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-value-equals"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "input[name=email]" },
    });
    fireEvent.change(screen.getByTestId("input-assert-value"), {
      target: { value: "a@b.c" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "value-equals",
      selector: "input[name=email]",
      assertValue: "a@b.c",
    });
    cap.remove();
  });

  it("response-status: { assertKind, assertStatusCode } as a number with no selector", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-response-status"));
    fireEvent.change(screen.getByTestId("input-assert-status-code"), {
      target: { value: "404" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "response-status",
      assertStatusCode: 404,
    });
    cap.remove();
  });

  it("appends insertBeforeIndex to the detail payload when provided", () => {
    render(
      <AddAssertionDialog
        open={true}
        onOpenChange={onOpenChange}
        insertBeforeIndex={2}
      />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-element-visible"));
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "#x" },
    });
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-add"));
    expect(cap.calls[0]!.detail).toEqual({
      assertKind: "element-visible",
      selector: "#x",
      insertBeforeIndex: 2,
    });
    cap.remove();
  });

  it("Cancel closes the dialog without dispatching an event", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    const cap = captureEvent("recorder:request-add-assertion");
    fireEvent.click(screen.getByTestId("button-assertion-cancel"));
    expect(cap.calls).toHaveLength(0);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cap.remove();
  });
});

describe("<AddAssertionDialog /> Add button disabled state guards required fields", () => {
  it("element-visible: Add stays disabled until a selector is entered", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-element-visible"));
    const add = screen.getByTestId("button-assertion-add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-assert-selector"), {
      target: { value: "#x" },
    });
    expect(add.disabled).toBe(false);
  });

  it("response-status: Add disabled when status is outside 100..599", () => {
    render(
      <AddAssertionDialog open={true} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId("radio-assert-response-status"));
    const add = screen.getByTestId("button-assertion-add") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("input-assert-status-code"), {
      target: { value: "999" },
    });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-assert-status-code"), {
      target: { value: "200" },
    });
    expect(add.disabled).toBe(false);
  });
});

describe("<AddAssertionDialog /> a11y branch", () => {
  it("emits an accessibility assertion with the chosen impact level (default serious)", () => {
    const onOpenChangeLocal = vi.fn();
    render(<AddAssertionDialog open={true} onOpenChange={onOpenChangeLocal} />);
    const dialog = screen.getByTestId("dialog-add-assertion");

    fireEvent.click(within(dialog).getByTestId("radio-assert-accessibility"));
    fireEvent.click(within(dialog).getByTestId("button-assertion-add"));

    expect(captured).toEqual([
      { assertKind: "accessibility", axeImpactLevel: "serious" },
    ]);
    expect(onOpenChangeLocal).toHaveBeenCalledWith(false);
  });
});

describe("<AddAssertionDialog /> visual-baseline branch", () => {
  it("requires a baseline name and a 0..1 threshold before enabling submit", () => {
    render(<AddAssertionDialog open={true} onOpenChange={vi.fn()} />);
    const dialog = screen.getByTestId("dialog-add-assertion");

    fireEvent.click(within(dialog).getByTestId("radio-assert-visual-baseline"));
    const submit = within(dialog).getByTestId("button-assertion-add");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByTestId("input-visual-name"), {
      target: { value: "home-page" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(within(dialog).getByTestId("input-visual-threshold"), {
      target: { value: "5" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(dialog).getByText(/Enter a number between 0 and 1/i),
    ).toBeTruthy();
  });

  it("emits a visual-baseline assertion with the trimmed name and numeric threshold", () => {
    render(<AddAssertionDialog open={true} onOpenChange={vi.fn()} />);
    const dialog = screen.getByTestId("dialog-add-assertion");

    fireEvent.click(within(dialog).getByTestId("radio-assert-visual-baseline"));
    fireEvent.change(within(dialog).getByTestId("input-visual-name"), {
      target: { value: "  checkout  " },
    });
    fireEvent.change(within(dialog).getByTestId("input-visual-threshold"), {
      target: { value: "0.1" },
    });
    fireEvent.click(within(dialog).getByTestId("button-assertion-add"));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      assertKind: "visual-baseline",
      visualName: "checkout",
      visualThreshold: 0.1,
    });
  });
});

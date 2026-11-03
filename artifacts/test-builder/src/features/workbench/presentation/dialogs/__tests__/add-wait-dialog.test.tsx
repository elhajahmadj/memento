/**
 * RTL specs for <AddWaitDialog />. The dialog dispatches a
 * `recorder:request-add-wait` CustomEvent whose detail is the per-kind
 * payload the recorder splices into the live action feed:
 *
 *   selector    -> { waitKind: "selector", waitSelector }
 *   networkidle -> { waitKind: "networkidle" }
 *   timeout     -> { waitKind: "timeout", waitMs }
 *
 * Add-button is disabled until each kind's required field validates
 * (non-empty selector for selector; positive ms <= 30_000 for timeout).
 * Networkidle requires no input and submits immediately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

import { AddWaitDialog } from "../add-wait-dialog";

function captureEvent(name: string): {
  calls: CustomEvent[];
  remove: () => void;
} {
  const calls: CustomEvent[] = [];
  const handler = (e: Event) => calls.push(e as CustomEvent);
  window.addEventListener(name, handler as EventListener);
  return {
    calls,
    remove: () => window.removeEventListener(name, handler as EventListener),
  };
}

let onOpenChange: ((v: boolean) => void) & ReturnType<typeof vi.fn>;

beforeEach(() => {
  onOpenChange = vi.fn() as unknown as typeof onOpenChange;
});

afterEach(() => {
  cleanup();
});

describe("<AddWaitDialog /> dispatches recorder:request-add-wait per kind", () => {
  it("selector: { waitKind: 'selector', waitSelector } and closes on Add", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByTestId("input-wait-selector"), {
      target: { value: "text=Welcome" },
    });
    const cap = captureEvent("recorder:request-add-wait");
    fireEvent.click(screen.getByTestId("button-wait-add"));
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0]!.detail).toEqual({
      waitKind: "selector",
      waitSelector: "text=Welcome",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cap.remove();
  });

  it("networkidle: { waitKind: 'networkidle' } with no other fields", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("radio-wait-networkidle"));
    const cap = captureEvent("recorder:request-add-wait");
    fireEvent.click(screen.getByTestId("button-wait-add"));
    expect(cap.calls[0]!.detail).toEqual({ waitKind: "networkidle" });
    cap.remove();
  });

  it("timeout: { waitKind: 'timeout', waitMs } as a number", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("radio-wait-timeout"));
    fireEvent.change(screen.getByTestId("input-wait-ms"), {
      target: { value: "1500" },
    });
    const cap = captureEvent("recorder:request-add-wait");
    fireEvent.click(screen.getByTestId("button-wait-add"));
    expect(cap.calls[0]!.detail).toEqual({
      waitKind: "timeout",
      waitMs: 1500,
    });
    cap.remove();
  });

  it("Cancel closes without dispatching any event", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    const cap = captureEvent("recorder:request-add-wait");
    fireEvent.click(screen.getByTestId("button-wait-cancel"));
    expect(cap.calls).toHaveLength(0);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cap.remove();
  });
});

describe("<AddWaitDialog /> Add-button disabled state", () => {
  it("selector: disabled until a non-empty selector is typed", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    const add = screen.getByTestId("button-wait-add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-wait-selector"), {
      target: { value: "#x" },
    });
    expect(add.disabled).toBe(false);
  });

  it("timeout: disabled when waitMs <= 0 or > 30_000", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("radio-wait-timeout"));
    const add = screen.getByTestId("button-wait-add") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("input-wait-ms"), {
      target: { value: "0" },
    });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-wait-ms"), {
      target: { value: "60000" },
    });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-wait-ms"), {
      target: { value: "1000" },
    });
    expect(add.disabled).toBe(false);
  });

  it("networkidle: enabled by default — no required field", () => {
    render(<AddWaitDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("radio-wait-networkidle"));
    const add = screen.getByTestId("button-wait-add") as HTMLButtonElement;
    expect(add.disabled).toBe(false);
  });
});

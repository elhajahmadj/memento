import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { AddApiCheckDialog } from "../add-api-check-dialog";

interface Detail {
  apiMethod: string;
  apiUrl: string;
  apiExpectedStatus: number;
  apiRequestBody: string | null;
  apiExpectedJson: string | null;
}

let captured: Detail[] = [];

beforeEach(() => {
  captured = [];
  window.addEventListener("recorder:request-add-api-assertion", listener as EventListener);
});

afterEach(() => {
  window.removeEventListener("recorder:request-add-api-assertion", listener as EventListener);
  cleanup();
});

const listener = (e: Event) => {
  captured.push((e as CustomEvent<Detail>).detail);
};

describe("<AddApiCheckDialog />", () => {
  it("dispatches the recorder:request-add-api-assertion event with the form data on submit", () => {
    const onOpenChange = vi.fn();
    render(<AddApiCheckDialog open={true} onOpenChange={onOpenChange} />);

    const dialog = screen.getByTestId("dialog-add-api-check");
    fireEvent.change(within(dialog).getByTestId("input-api-url"), {
      target: { value: "https://api.example.com/me" },
    });
    fireEvent.change(within(dialog).getByTestId("input-api-status"), {
      target: { value: "201" },
    });
    fireEvent.change(within(dialog).getByTestId("input-api-expected-json"), {
      target: { value: '{"id":"u1"}' },
    });

    fireEvent.click(within(dialog).getByTestId("button-api-check-add"));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      apiMethod: "GET",
      apiUrl: "https://api.example.com/me",
      apiExpectedStatus: 201,
      apiRequestBody: null,
      apiExpectedJson: '{"id":"u1"}',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables submit while URL is empty or status is out of range", () => {
    render(<AddApiCheckDialog open={true} onOpenChange={vi.fn()} />);
    const dialog = screen.getByTestId("dialog-add-api-check");
    const submit = within(dialog).getByTestId("button-api-check-add");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByTestId("input-api-url"), {
      target: { value: "https://x" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(within(dialog).getByTestId("input-api-status"), {
      target: { value: "12" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/integer between 100 and 599/i)).toBeTruthy();
  });

  it("blocks submit on invalid expected-JSON", () => {
    render(<AddApiCheckDialog open={true} onOpenChange={vi.fn()} />);
    const dialog = screen.getByTestId("dialog-add-api-check");
    fireEvent.change(within(dialog).getByTestId("input-api-url"), {
      target: { value: "https://x" },
    });
    fireEvent.change(within(dialog).getByTestId("input-api-expected-json"), {
      target: { value: "not-json" },
    });
    expect((within(dialog).getByTestId("button-api-check-add") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/Expected JSON must be valid JSON/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByTestId("button-api-check-add"));
    expect(captured).toHaveLength(0);
  });
});

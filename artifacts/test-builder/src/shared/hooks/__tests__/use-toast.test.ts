import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { reducer, toast, useToast } from "../use-toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  // Drain any toasts left over so tests don't bleed into each other.
  const { result } = renderHook(() => useToast());
  act(() => {
    result.current.dismiss();
  });
});

describe("toast() + useToast()", () => {
  it("starts with an empty toast list", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("toast() appends a toast that is observable from useToast()", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "Saved" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Saved");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("only the most recent toast is kept (TOAST_LIMIT = 1)", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "First" });
      toast({ title: "Second" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss(id) closes that toast (open=false) without removing it immediately", () => {
    const { result } = renderHook(() => useToast());
    let id = "";
    act(() => {
      const t = toast({ title: "Hello" });
      id = t.id;
    });
    act(() => {
      result.current.dismiss(id);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("dismiss() with no id closes every toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "One" });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.toasts.every((t) => t.open === false)).toBe(true);
  });
});

describe("reducer (pure transitions)", () => {
  it("ADD_TOAST inserts and respects the limit of 1", () => {
    const a = { id: "a", open: true } as Parameters<typeof reducer>[0]["toasts"][number];
    const b = { id: "b", open: true } as typeof a;
    const s1 = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: a });
    const s2 = reducer(s1, { type: "ADD_TOAST", toast: b });
    expect(s2.toasts).toHaveLength(1);
    expect(s2.toasts[0].id).toBe("b");
  });

  it("UPDATE_TOAST merges fields by id", () => {
    const a = { id: "a", open: true, title: "old" } as Parameters<typeof reducer>[0]["toasts"][number];
    const s1 = reducer({ toasts: [a] }, {
      type: "UPDATE_TOAST",
      toast: { id: "a", title: "new" },
    });
    expect(s1.toasts[0].title).toBe("new");
  });

  it("REMOVE_TOAST without an id clears every toast", () => {
    const a = { id: "a", open: true } as Parameters<typeof reducer>[0]["toasts"][number];
    const s1 = reducer({ toasts: [a] }, {
      type: "REMOVE_TOAST",
      toastId: undefined,
    });
    expect(s1.toasts).toEqual([]);
  });

  it("REMOVE_TOAST with an id removes only that toast", () => {
    const a = { id: "a", open: true } as Parameters<typeof reducer>[0]["toasts"][number];
    const b = { id: "b", open: true } as typeof a;
    const s1 = reducer({ toasts: [a, b] }, {
      type: "REMOVE_TOAST",
      toastId: "a",
    });
    expect(s1.toasts.map((t) => t.id)).toEqual(["b"]);
  });
});

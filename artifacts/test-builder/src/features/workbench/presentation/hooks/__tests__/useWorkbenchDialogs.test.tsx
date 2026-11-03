import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useWorkbenchDialogs } from "../useWorkbenchDialogs";

afterEach(() => cleanup());

describe("useWorkbenchDialogs", () => {
  it("initializes every dialog to its closed/empty state", () => {
    const { result } = renderHook(() => useWorkbenchDialogs());
    expect(result.current.startDialogOpen).toBe(false);
    expect(result.current.attachDialogOpen).toBe(false);
    expect(result.current.buildTestOpen).toBe(false);
    expect(result.current.addClassOpen).toBe(false);
    expect(result.current.addMethodFor).toBeNull();
    expect(result.current.renameTarget).toBeNull();
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.addFolderUnder).toBeNull();
    expect(result.current.addFileUnder).toBeNull();
    expect(result.current.validateOpen).toBe(false);
  });

  it("toggles boolean dialog flags", () => {
    const { result } = renderHook(() => useWorkbenchDialogs());
    act(() => result.current.setStartDialogOpen(true));
    act(() => result.current.setValidateOpen(true));
    expect(result.current.startDialogOpen).toBe(true);
    expect(result.current.validateOpen).toBe(true);
  });

  it("stores targets for keyed dialogs", () => {
    const { result } = renderHook(() => useWorkbenchDialogs());
    act(() => result.current.setAddMethodFor("tests/A.cs"));
    act(() =>
      result.current.setRenameTarget({
        name: "x",
        path: "x",
        type: "file",
      }),
    );
    expect(result.current.addMethodFor).toBe("tests/A.cs");
    expect(result.current.renameTarget?.path).toBe("x");
  });
});

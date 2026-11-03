import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { invalidateDiscoveredTests } from "../invalidate-discovered-tests";

describe("invalidateDiscoveredTests", () => {
  it("invalidates only the discover-project-tests queries (any project id) and leaves siblings alone", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const qc = { invalidateQueries } as unknown as QueryClient;

    await invalidateDiscoveredTests(qc);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const arg = invalidateQueries.mock.calls[0][0] as {
      predicate: (q: { queryKey: readonly unknown[] }) => boolean;
    };

    expect(
      arg.predicate({ queryKey: ["/api/projects/abc-123/tests"] }),
    ).toBe(true);
    expect(
      arg.predicate({ queryKey: ["/api/projects/00000000-0000-0000-0000-000000000001/tests"] }),
    ).toBe(true);
    // Sibling endpoints under /api/projects must not be touched
    expect(arg.predicate({ queryKey: ["/api/projects/abc/tree"] })).toBe(false);
    expect(arg.predicate({ queryKey: ["/api/projects"] })).toBe(false);
    expect(arg.predicate({ queryKey: ["/api/healthz"] })).toBe(false);
    // Defensive: empty / non-array / non-string keys must not match
    expect(arg.predicate({ queryKey: [] })).toBe(false);
    expect(
      arg.predicate({ queryKey: [{ kind: "obj" }] as readonly unknown[] }),
    ).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const useListAuditEventsMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListAuditEvents: (params: unknown, opts?: unknown) =>
      useListAuditEventsMock(params, opts),
    useListAvailableProjects: () => ({ data: [], isLoading: false }),
    getListAuditEventsQueryKey: (p: unknown) => ["audit", p],
  };
});

import { ActivitySection } from "../settings-activity";

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActivitySection />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  useListAuditEventsMock.mockReset();
});

describe("<ActivitySection />", () => {
  it("shows a loading spinner while audit events are loading", () => {
    useListAuditEventsMock.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });
    renderSection();
    expect(screen.getByTestId("section-activity")).toBeDefined();
  });

  it("renders the empty state when no events are returned", () => {
    useListAuditEventsMock.mockReturnValue({
      data: { events: [], page: 1, pageSize: 10, total: 0 },
      isLoading: false,
      isFetching: false,
    });
    renderSection();
    expect(screen.getByTestId("audit-empty")).toBeDefined();
  });

  it("renders one row per audit event and toggles the details on click", async () => {
    useListAuditEventsMock.mockReturnValue({
      data: {
        page: 1,
        pageSize: 10,
        total: 1,
        events: [
          {
            id: "ev1",
            createdAt: "2026-04-28T00:00:00Z",
            userId: "u1",
            firstName: "Alice",
            lastName: "Anderson",
            username: "alice",
            project: "Demo",
            action: "file_save",
            filePath: "src/Foo.cs",
            details: { lines: 10 },
          },
        ],
      },
      isLoading: false,
      isFetching: false,
    });
    renderSection();
    expect(screen.getByTestId("row-audit-ev1")).toBeDefined();
    expect(screen.queryByTestId("details-audit-ev1")).toBeNull();
    fireEvent.click(screen.getByTestId("row-audit-ev1"));
    await waitFor(() =>
      expect(screen.getByTestId("details-audit-ev1")).toBeDefined(),
    );
    expect(screen.getByTestId("details-audit-ev1").textContent).toContain(
      "lines",
    );
  });

  it("clicking 'Apply' on the user filter triggers a re-render", () => {
    useListAuditEventsMock.mockReturnValue({
      data: { events: [], page: 1, pageSize: 10, total: 0 },
      isLoading: false,
      isFetching: false,
    });
    renderSection();
    fireEvent.change(screen.getByTestId("input-audit-user"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByTestId("button-audit-apply-user"));
    // Hook gets called again with the new filter — at least one call should
    // have included { user: "alice" } in its params.
    const calls = useListAuditEventsMock.mock.calls;
    const sawUser = calls.some(
      (c) => (c[0] as { user?: string })?.user === "alice",
    );
    expect(sawUser).toBe(true);
  });
});

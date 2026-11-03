/**
 * RTL specs for <ToolsTestRuns /> — the validation dashboard.
 *
 * This spec covers:
 *   - Role gating (non-admins are redirected away)
 *   - Static rendering (heading, controls, empty state)
 *   - Run-all flow (invokes startValidateAll, toasts, refetches)
 *   - History list (renders one row per run)
 *   - Trends dashboard (sparkline + flakiness aggregates)
 *
 * The dashboard is the user-visible payoff of the validation-runs API:
 * after queueing a run from the workbench, navigating to
 * `/tools/test-runs` should show the freshly-finished run in the
 * history list and — once enough runs accumulate — render the
 * Sparkline + flakiness percentage in the per-test trends section.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthUserRole } from "@workspace/api-client-react";

const navigateMock = vi.fn();
const useIsAnyAdminMock = vi.fn();
const useAuthMock = vi.fn();
const listValidationRunsMock = vi.fn();
const startValidateAllMock = vi.fn();
const getValidationRunMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/tools/test-runs", navigateMock],
  Link: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href?: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@/features/auth/presentation/role", () => ({
  useIsAnyAdmin: () => useIsAnyAdminMock(),
  // The nav shells hide Documentation from guest trial sessions, so
  // TopNav/SideNav now read this. These tests render as an admin.
  useIsGuest: () => false,
  // The shared SwitchOrgGate helper pulls `useOrgsMatchingRole` and
  // `ROLE_PREDICATES` from this module; stub them so SSO-less local
  // tests behave like a single-org user (no qualifying candidates →
  // gate falls through to redirect, matching prior behavior).
  useOrgsMatchingRole: () => [],
  ROLE_PREDICATES: {
    admin: () => false,
    anyAdmin: () => false,
    limitedAdmin: () => false,
  },
}));

vi.mock("@/features/auth/presentation/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    theme: "dark",
    isDark: true,
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  useIsDarkTheme: () => true,
}));

vi.mock("@/features/approvals/presentation/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="bell" />,
}));

vi.mock("@/features/auth/presentation/user-menu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

// Build a stable, recent timestamp so rows fall inside the 30-day
// trend window the page enforces in `summarizeByTest`.
const NOW = Date.now();
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

const FIXTURE_RUNS = [
  // Newest first — the API contract the page assumes. Three finished
  // runs with one status-flip (passed → failed) yields flakiness =
  // 1/(3-1) = 50% and pass rate = 2/3.
  {
    id: "r3",
    status: "passed",
    queuedAt: at(5),
    startedAt: at(5),
    finishedAt: at(4),
    recordingFilePath: "tests/login.spec.ts",
    recordingMethodName: "logsIn",
    recordingKind: "playwright",
    parentRunId: null,
    traceRef: null,
    summary: { steps: [] },
  },
  {
    id: "r2",
    status: "failed",
    queuedAt: at(15),
    startedAt: at(15),
    finishedAt: at(14),
    recordingFilePath: "tests/login.spec.ts",
    recordingMethodName: "logsIn",
    recordingKind: "playwright",
    parentRunId: null,
    traceRef: null,
    summary: { steps: [] },
  },
  {
    id: "r1",
    status: "passed",
    queuedAt: at(30),
    startedAt: at(30),
    finishedAt: at(29),
    recordingFilePath: "tests/login.spec.ts",
    recordingMethodName: "logsIn",
    recordingKind: "playwright",
    parentRunId: null,
    traceRef: null,
    summary: { steps: [] },
  },
] as const;

// Hoisted mock state so the vi.mock factory (which runs *before* any
// top-level code) and the test bodies share the same handles. The
// `runs` array is mutated mid-test to simulate a freshly-queued run
// becoming visible after a refetch. Both the mock fns AND their
// captured state must be created inside `vi.hoisted` because the
// `vi.mock` factory below also runs hoisted — anything assigned at
// module-evaluation time would still be `undefined` when the factory
// runs.
const apiMocks = vi.hoisted(() => {
  const state = { runs: [] as unknown[] };
  // IMPORTANT: return a *fresh* array each call. React Query bails on
  // re-renders when the query function returns a referentially-equal
  // value, so mutating one shared array in place would leave the
  // component stuck on the initial empty list.
  const listValidationRuns = vi.fn(async (..._args: unknown[]) => state.runs.slice());
  const startValidateAll = vi.fn(async (..._args: unknown[]) => ({ id: "queued-run" }));
  return {
    setRuns(next: unknown[]) {
      state.runs = next;
    },
    listValidationRuns,
    startValidateAll,
  };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listValidationRuns: (...a: unknown[]) => {
      // If listValidationRunsMock has been programmed, use it; otherwise fallback to apiMocks
      if (listValidationRunsMock.getMockImplementation()) {
        return listValidationRunsMock(...a);
      }
      return apiMocks.listValidationRuns(...a);
    },
    startValidateAll: (...a: unknown[]) => {
      if (startValidateAllMock.getMockImplementation()) {
        return startValidateAllMock(...a);
      }
      return apiMocks.startValidateAll(...a);
    },
    getValidationRun: (...a: unknown[]) => getValidationRunMock(...a),
    validationTraceUrl: (id: string) => `/api/validation/runs/${id}/trace`,
    validationScreenshotUrl: (id: string) =>
      `/api/validation/runs/${id}/screenshot`,
  };
});

import { ToolsTestRuns } from "../tools-test-runs";

function setRole(role: AuthUserRole) {
  useIsAnyAdminMock.mockReturnValue(role === "admin" || role === "limited_admin");
  useAuthMock.mockReturnValue({
    user: { id: "u", username: "u", role, profileComplete: true },
    loading: false,
    logout: vi.fn(),
  });
}

function renderPage() {
  // Disable retries so a query failure surfaces immediately instead of
  // looping inside `waitFor`.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToolsTestRuns />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  useIsAnyAdminMock.mockReset();
  useAuthMock.mockReset();
  apiMocks.setRuns([]);
  apiMocks.listValidationRuns.mockClear();
  apiMocks.startValidateAll.mockClear();
  listValidationRunsMock.mockReset();
  startValidateAllMock.mockReset();
  getValidationRunMock.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("<ToolsTestRuns /> role gate", () => {
  it("redirects non-admins with an error toast", () => {
    setRole("limited");
    listValidationRunsMock.mockResolvedValue([]);
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    expect(toastError).toHaveBeenCalledWith("You don't have access to Tools");
  });
});

describe("<ToolsTestRuns /> as admin", () => {
  it("renders the page heading + the Run all / Refresh controls", async () => {
    setRole("admin");
    listValidationRunsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Test runs/i)).toBeDefined(),
    );
    expect(screen.getByTestId("button-test-runs-run-all")).toBeDefined();
    expect(screen.getByTestId("button-test-runs-refresh")).toBeDefined();
  });

  it("shows the empty card when listValidationRuns returns an empty array", async () => {
    setRole("admin");
    listValidationRunsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("card-test-runs-empty")).toBeDefined(),
    );
  });

  it("clicking Run all invokes startValidateAll and toasts success", async () => {
    setRole("admin");
    listValidationRunsMock.mockResolvedValue([]);
    startValidateAllMock.mockResolvedValue({ id: "parent-run-id" });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("button-test-runs-run-all")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("button-test-runs-run-all"));
    await waitFor(() =>
      expect(startValidateAllMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Validate all queued"),
    );
  });

  it("toasts an error message when startValidateAll rejects", async () => {
    setRole("admin");
    listValidationRunsMock.mockResolvedValue([]);
    startValidateAllMock.mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("button-test-runs-run-all")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("button-test-runs-run-all"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("boom"),
    );
  });

  it("renders one row per validation run with the row test id keyed by id", async () => {
    setRole("admin");
    listValidationRunsMock.mockResolvedValue([
      {
        id: "run-1",
        projectName: "Acme",
        recordingFilePath: "Tests/Login.cs",
        recordingKind: "testMethod",
        recordingMethodName: "HappyPath",
        status: "passed",
        queuedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: {},
        traceRef: null,
        triggeredByUserId: "u1",
        parentRunId: null,
      },
      {
        id: "run-2",
        projectName: "Acme",
        recordingFilePath: "Tests/Logout.cs",
        recordingKind: "testMethod",
        recordingMethodName: "Quick",
        status: "failed",
        queuedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: {},
        traceRef: null,
        triggeredByUserId: "u1",
        parentRunId: null,
      },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("row-test-run-run-1")).toBeDefined(),
    );
    expect(screen.getByTestId("row-test-run-run-2")).toBeDefined();
  });

  it("renders the per-test trends section and a sparkline when there are finished runs in the trend window", async () => {
    setRole("admin");
    // Two runs against the same recording so summarizeByTest produces
    // a single group with the sparkline rendered next to it.
    const recent = new Date().toISOString();
    listValidationRunsMock.mockResolvedValue([
      {
        id: "trend-1",
        projectName: "Acme",
        recordingFilePath: "Tests/Login.cs",
        recordingKind: "testMethod",
        recordingMethodName: "HappyPath",
        status: "passed",
        queuedAt: recent,
        startedAt: recent,
        finishedAt: recent,
        summary: {},
        traceRef: null,
        triggeredByUserId: "u1",
        parentRunId: null,
      },
      {
        id: "trend-2",
        projectName: "Acme",
        recordingFilePath: "Tests/Login.cs",
        recordingKind: "testMethod",
        recordingMethodName: "HappyPath",
        status: "failed",
        queuedAt: recent,
        startedAt: recent,
        finishedAt: recent,
        summary: {},
        traceRef: null,
        triggeredByUserId: "u1",
        parentRunId: null,
      },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("heading-test-run-trends")).toBeDefined(),
    );
    expect(screen.getByTestId("card-test-run-trends")).toBeDefined();
    // 50% pass / 50% fail across the 2-run window.
    const trendRows = screen.getAllByTestId(/^row-test-run-trend-/);
    // At least one row beyond the header.
    expect(trendRows.length).toBeGreaterThanOrEqual(2);
    const sparklines = screen.getAllByTestId("sparkline-runs");
    expect(sparklines.length).toBeGreaterThanOrEqual(1);
    // Sparkline draws one <rect> per run in the window.
    const rects = sparklines[0]!.querySelectorAll("rect");
    expect(rects.length).toBe(2);
  });

  it("expanding a row drills down via getValidationRun and renders failed step details + trace link", async () => {
    setRole("admin");
    const recent = new Date().toISOString();
    const runRow = {
      id: "drill-1",
      projectName: "Acme",
      recordingFilePath: "Tests/Login.cs",
      recordingKind: "testMethod" as const,
      recordingMethodName: "HappyPath",
      status: "failed" as const,
      queuedAt: recent,
      startedAt: recent,
      finishedAt: recent,
      summary: {
        durationMs: 1234,
        failureMessage: "expected text 'Welcome' to be visible",
        steps: [
          {
            index: 0,
            type: "click",
            selector: '[data-testid="login"]',
            value: null,
            status: "passed",
            durationMs: 110,
            error: null,
          },
          {
            index: 1,
            type: "assert",
            selector: '[data-testid="welcome"]',
            value: null,
            status: "failed",
            durationMs: 220,
            error: "Timed out waiting for selector",
          },
        ],
      },
      traceRef: "trace-drill-1.zip",
      triggeredByUserId: "u1",
      parentRunId: null,
    };
    listValidationRunsMock.mockResolvedValue([runRow]);
    getValidationRunMock.mockResolvedValue(runRow);

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("button-toggle-run-drill-1")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("button-toggle-run-drill-1"));
    await waitFor(() =>
      expect(screen.getByTestId("list-run-detail-steps-drill-1")).toBeDefined(),
    );
    expect(getValidationRunMock).toHaveBeenCalledWith("drill-1");
    expect(
      screen.getByTestId("row-run-detail-step-drill-1-0"),
    ).toBeDefined();
    expect(
      screen.getByTestId("row-run-detail-step-drill-1-1"),
    ).toBeDefined();
    // The failureMessage / per-step error should both surface.
    expect(
      screen.getByTestId("text-run-detail-failure-drill-1").textContent,
    ).toContain("Welcome");
    expect(
      screen.getByTestId("row-run-detail-step-drill-1-1").textContent,
    ).toContain("Timed out");
    // Trace download link is keyed by runId and is only rendered when
    // `traceRef` is set on the fetched run.
    expect(
      screen.getByTestId("link-run-detail-trace-drill-1"),
    ).toBeDefined();
  });

  it("expanding a parent-of-all run shows the aggregate child-run counts (no per-step list)", async () => {
    setRole("admin");
    const recent = new Date().toISOString();
    const parentRow = {
      id: "parent-1",
      projectName: "Acme",
      recordingFilePath: null,
      recordingKind: "all" as const,
      recordingMethodName: null,
      status: "failed" as const,
      queuedAt: recent,
      startedAt: recent,
      finishedAt: recent,
      summary: {
        plannedChildren: 3,
        passedChildren: 1,
        failedChildren: 2,
        erroredChildren: 0,
      },
      traceRef: null,
      triggeredByUserId: "u1",
      parentRunId: null,
    };
    listValidationRunsMock.mockResolvedValue([parentRow]);
    getValidationRunMock.mockResolvedValue(parentRow);

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("button-toggle-run-parent-1")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("button-toggle-run-parent-1"));
    await waitFor(() =>
      expect(screen.getByTestId("text-run-detail-parent-parent-1")).toBeDefined(),
    );
    const txt =
      screen.getByTestId("text-run-detail-parent-parent-1").textContent ?? "";
    expect(txt).toMatch(/1 passed/);
    expect(txt).toMatch(/2 failed/);
    expect(txt).toMatch(/3 child runs/);
    // Parent-of-all has no per-step list.
    expect(screen.queryByTestId("list-run-detail-steps-parent-1")).toBeNull();
  });
});

describe("<ToolsTestRuns /> trends smoke", () => {
  it("renders sparkline + flakiness badge for an aggregated test", async () => {
    setRole("admin");
    apiMocks.setRuns([...FIXTURE_RUNS] as unknown[]);
    renderPage();

    // The dashboard waits on the list query; once it resolves the
    // history list and trends section appear together. We assert on
    // the trends-specific testids so a regression in `summarizeByTest`
    // (e.g. excluding all rows by mistake) fails this spec.
    await waitFor(() => {
      expect(screen.getByTestId("heading-test-run-trends")).toBeDefined();
    });

    // The group key is `${recordingFilePath}::${methodName ?? ""}`.
    const groupKey = "tests/login.spec.ts::logsIn";
    expect(
      screen.getByTestId(`row-test-run-trend-${groupKey}`),
    ).toBeDefined();

    // 100% flakiness: the synthetic runs alternate pass→fail→pass,
    // i.e. every consecutive pair flips. Anything else means the
    // flip-rate computation broke.
    const flak = screen.getByTestId(
      `text-test-run-trend-flakiness-${groupKey}`,
    );
    expect(flak.textContent).toContain("100%");

    // Sparkline renders one <rect> per finished run in the window.
    // Both presence and bar-count guard against an SVG-render
    // regression that shipped no bars.
    const sparkline = screen.getByTestId("sparkline-runs");
    expect(sparkline).toBeDefined();
    expect(sparkline.querySelectorAll("rect").length).toBe(
      FIXTURE_RUNS.length,
    );
  });

  it("queues a run via Run all tests and surfaces trends after the refetch", async () => {
    // The full user journey the task description calls out: load the
    // page with no runs yet → click "Run all tests" → the page calls
    // `startValidateAll` and refetches → the new history shows up
    // and the trends row + sparkline render. This protects against
    // regressions where the refetch is dropped, the button forgets
    // to call `startValidateAll`, or the trend computation chokes
    // on the freshly-arrived data.
    setRole("admin");
    apiMocks.setRuns([]);
    renderPage();

    // Empty state first — proves the page actually consumed the
    // initial empty list rather than racing to the populated one.
    await waitFor(() => {
      expect(screen.getByTestId("card-test-runs-empty")).toBeDefined();
    });
    expect(apiMocks.startValidateAll).not.toHaveBeenCalled();

    // Stage the post-queue dataset *before* the click, since the
    // page's `handleRunAll` awaits `startValidateAll` and then
    // immediately fires `refetch()`. The refetch will hit the mock
    // again and pick up the new array.
    apiMocks.setRuns([...FIXTURE_RUNS] as unknown[]);
    const callsBefore = apiMocks.listValidationRuns.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-test-runs-run-all"));
    });
    expect(apiMocks.startValidateAll).toHaveBeenCalledTimes(1);

    // The page's `handleRunAll` fires `refetch()` after the click, so
    // `listValidationRuns` must be invoked at least once more than
    // before the click. Wait for that re-invocation explicitly so we
    // don't race the React Query scheduler.
    await waitFor(() => {
      expect(
        apiMocks.listValidationRuns.mock.calls.length,
      ).toBeGreaterThan(callsBefore);
    });

    // Trends + sparkline must appear after the refetch resolves.
    await waitFor(() => {
      expect(screen.getByTestId("heading-test-run-trends")).toBeDefined();
    });
    const groupKey = "tests/login.spec.ts::logsIn";
    const flak = screen.getByTestId(
      `text-test-run-trend-flakiness-${groupKey}`,
    );
    expect(flak.textContent).toContain("100%");
    expect(
      screen.getByTestId("sparkline-runs").querySelectorAll("rect").length,
    ).toBe(FIXTURE_RUNS.length);
  });
});

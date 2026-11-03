import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const toastInfo = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
  Toaster: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/settings", vi.fn()],
  // The Settings page tree pulls in the global Logo component which
  // depends on wouter's <Link>; render it as a passthrough <a> so the
  // page can mount in jsdom without a real Router/Switch wrapper.
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

// The Settings page tree pulls in <UserMenu>, which calls useTheme(). Stub
// the theme hook so the page mounts without a ThemeProvider.
vi.mock("@/shared/hooks/use-theme", () => ({
  useTheme: () => ({
    isDark: false,
    theme: "light" as const,
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
  useIsDarkTheme: () => false,
}));

// Settings transitively calls useIsAdmin/useIsAnyAdmin/useAuth via the Settings
// page tree. Stub the auth context with an admin user so the page renders past
// the role gate without needing a real AuthProvider in the test render tree.
vi.mock("@/features/auth/presentation/auth-context", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    user: {
      id: "test-user",
      username: "tester",
      role: "admin",
      profile: {},
    },
    organizations: [],
    activeOrgId: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    updateProfile: vi.fn(),
    setActiveOrg: vi.fn(),
  }),
}));

let upsertCalls: Array<{ name: string }> = [];

// The Settings page tree pulls in many generated hooks/utilities from
// @workspace/api-client-react. Pull the real module (so all named exports —
// including enums like ListAuditEventsAction — are present) and override
// only the few hooks this test cares about. Unmocked hooks will fire real
// fetches that fail in jsdom; QueryClient with retry: false swallows those
// rejections so the page still renders past them.
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useListArchitectures: () => ({ data: [], isLoading: false }),
    useUpsertArchitecture: (opts?: {
      mutation?: {
        onSuccess?: (data: unknown) => void | Promise<void>;
        onError?: (e: Error) => void;
      };
    }) => {
      const mutateAsync = vi.fn(async ({ data }: { data: { name: string } }) => {
        upsertCalls.push({ name: data.name });
        const saved = {
          ...data,
          id: `arch-${upsertCalls.length}`,
        };
        await opts?.mutation?.onSuccess?.(saved);
        return saved;
      });
      return { mutateAsync, isPending: false };
    },
    useDeleteArchitecture: () => ({
      mutateAsync: vi.fn(async () => undefined),
      isPending: false,
    }),
    useListAvailableProjects: () => ({ data: [], isLoading: false }),
    useSetProjectDisabled: () => ({
      mutateAsync: vi.fn(async () => undefined),
      isPending: false,
    }),
    useDeleteProject: () => ({
      mutateAsync: vi.fn(async () => undefined),
      isPending: false,
    }),
    getListArchitecturesQueryKey: () => ["list-architectures"],
    getGetCurrentProjectQueryKey: () => ["get-current-project"],
  };
});

import { ArchitecturesPanel } from "../../sections/architectures-panel";

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ArchitecturesPanel defaultOpen />
    </QueryClientProvider>,
  );
}

function makeJsonFile(name: string, contents: string): File {
  // jsdom's File supports text(); fall back to defineProperty just in case.
  const file = new File([contents], name, { type: "application/json" });
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", {
      value: async () => contents,
    });
  }
  return file;
}

const goodArchA = JSON.stringify({
  name: "Good Architecture A",
  projects: [{ nameSuffix: ".Tests", isTestsProject: true, folders: [], files: [] }],
});

const goodArchBFixed = JSON.stringify({
  name: "Good Architecture B",
  projects: [{ nameSuffix: ".Tests", isTestsProject: true, folders: [], files: [] }],
});

describe("retry failed import flow", () => {
  beforeEach(() => {
    upsertCalls = [];
    toastSuccess.mockClear();
    toastError.mockClear();
    toastWarning.mockClear();
    toastInfo.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("retries a failing file in place and flips its row to success", async () => {
    renderSettings();

    const importInput = screen.getByTestId(
      "input-import-architecture",
    ) as HTMLInputElement;

    const goodFile = makeJsonFile("good-a.json", goodArchA);
    const badFile = makeJsonFile("bad-b.json", "{ this is not json");

    fireEvent.change(importInput, { target: { files: [goodFile, badFile] } });

    // Results dialog opens with both rows; second one is the failure.
    const dialog = await screen.findByTestId("dialog-import-results");
    await within(dialog).findByText(/1 of 2 files imported successfully/i);

    const failingRow = within(dialog).getByTestId("row-import-result-1");
    expect(within(failingRow).getByText("bad-b.json")).toBeDefined();
    expect(within(failingRow).getByText(/not valid JSON/i)).toBeDefined();

    // Sanity: the upsert pipeline ran exactly once (only the good file).
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].name).toBe("Good Architecture A");

    // Click Retry failed → handler should open the hidden retry input via
    // .click(). Spy on that so we know the button-to-input wiring fires,
    // then deliver the file via change (jsdom can't show a real picker).
    const retryInput = within(dialog).getByTestId(
      "input-retry-failed-import",
    ) as HTMLInputElement;
    const inputClickSpy = vi.spyOn(retryInput, "click");

    const retryButton = within(dialog).getByTestId("button-retry-failed-import");
    fireEvent.click(retryButton);
    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    const fixedFile = makeJsonFile("bad-b.json", goodArchBFixed);
    fireEvent.change(retryInput, { target: { files: [fixedFile] } });

    // The failing row flips to success in place; index 1 stays the same.
    await waitFor(() => {
      const updated = screen.getByTestId("row-import-result-1");
      expect(within(updated).getByText("bad-b.json")).toBeDefined();
      expect(within(updated).getByText("Good Architecture B")).toBeDefined();
    });

    // The previously-good row at index 0 is untouched.
    const goodRow = screen.getByTestId("row-import-result-0");
    expect(within(goodRow).getByText("good-a.json")).toBeDefined();
    expect(within(goodRow).getByText("Good Architecture A")).toBeDefined();

    // Header summary updates to 2 of 2.
    await screen.findByText(/2 of 2 files imported successfully/i);

    // The retry-failed button disappears once nothing is failing.
    expect(screen.queryByTestId("button-retry-failed-import")).toBeNull();

    // The retried file actually went through the upsert pipeline.
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[1].name).toBe("Good Architecture B");

    // Success toast for the single retried file.
    expect(toastSuccess).toHaveBeenCalledWith("Retry succeeded");

    // No "ignored" info toast: every chosen file matched.
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("shows an error toast when no chosen file matches a failed import name", async () => {
    renderSettings();

    const importInput = screen.getByTestId(
      "input-import-architecture",
    ) as HTMLInputElement;

    fireEvent.change(importInput, {
      target: {
        files: [
          makeJsonFile("good-a.json", goodArchA),
          makeJsonFile("bad-b.json", "{ broken json"),
        ],
      },
    });

    const dialog = await screen.findByTestId("dialog-import-results");
    await within(dialog).findByText(/1 of 2 files imported successfully/i);

    const upsertsBefore = upsertCalls.length;
    toastError.mockClear();

    // Pick a file whose name does not match any failing entry.
    const retryInput = within(dialog).getByTestId(
      "input-retry-failed-import",
    ) as HTMLInputElement;
    fireEvent.change(retryInput, {
      target: {
        files: [makeJsonFile("totally-different.json", goodArchBFixed)],
      },
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "That file's name doesn't match any failed import",
      );
    });

    // The failing row is still failing; nothing was retried.
    const stillFailing = screen.getByTestId("row-import-result-1");
    expect(within(stillFailing).getByText("bad-b.json")).toBeDefined();
    expect(within(stillFailing).getByText(/not valid JSON/i)).toBeDefined();
    expect(upsertCalls).toHaveLength(upsertsBefore);
    expect(
      screen.getByTestId("button-retry-failed-import"),
    ).toBeDefined();
  });

  it("retries the matching file and surfaces an info toast for ignored ones", async () => {
    renderSettings();

    const importInput = screen.getByTestId(
      "input-import-architecture",
    ) as HTMLInputElement;

    fireEvent.change(importInput, {
      target: {
        files: [
          makeJsonFile("good-a.json", goodArchA),
          makeJsonFile("bad-b.json", "{ broken json"),
        ],
      },
    });

    const dialog = await screen.findByTestId("dialog-import-results");
    await within(dialog).findByText(/1 of 2 files imported successfully/i);

    const upsertsBefore = upsertCalls.length;

    // Pick two files: one matches the failing name, one does not.
    const retryInput = within(dialog).getByTestId(
      "input-retry-failed-import",
    ) as HTMLInputElement;
    fireEvent.change(retryInput, {
      target: {
        files: [
          makeJsonFile("bad-b.json", goodArchBFixed),
          makeJsonFile("totally-different.json", goodArchA),
        ],
      },
    });

    // Failing row flipped to success.
    await waitFor(() => {
      const updated = screen.getByTestId("row-import-result-1");
      expect(within(updated).getByText("Good Architecture B")).toBeDefined();
    });

    // Only the matching file went through the upsert pipeline.
    expect(upsertCalls.length).toBe(upsertsBefore + 1);
    expect(upsertCalls.at(-1)?.name).toBe("Good Architecture B");

    // Success toast for the single retried match.
    expect(toastSuccess).toHaveBeenCalledWith("Retry succeeded");

    // Info toast surfaces the singular "1 chosen file didn't match" copy.
    expect(toastInfo).toHaveBeenCalledWith(
      "1 chosen file didn't match a failed import name and was skipped",
    );
  });
});

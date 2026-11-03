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

const { upsertMock, toastMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

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
    useUpsertArchitecture: () => ({ mutateAsync: upsertMock, isPending: false }),
    useDeleteArchitecture: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useListAvailableProjects: () => ({ data: [], isLoading: false }),
    useSetProjectDisabled: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteProject: () => ({ mutate: vi.fn(), isPending: false }),
    getListArchitecturesQueryKey: () => ["architectures"],
    getGetCurrentProjectQueryKey: () => ["currentProject"],
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
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

vi.mock("sonner", () => ({ toast: toastMock }));

import { ArchitecturesPanel } from "../../sections/architectures-panel";

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ArchitecturesPanel defaultOpen />
    </QueryClientProvider>,
  );
}

function makeFile(name: string, content: string): File {
  const file = new File([content], name, { type: "application/json" });
  // jsdom's File doesn't implement .text(); polyfill it so importOneFile can
  // read the dropped JSON synchronously-via-promise like the browser does.
  if (typeof file.text !== "function") {
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(content),
    });
  }
  return file;
}

function validArch(name: string) {
  return {
    name,
    projects: [
      {
        id: "p1",
        nameSuffix: ".Tests",
        isTestsProject: true,
        slnGuid: "{00000000-0000-0000-0000-000000000001}",
        folders: [],
        files: [],
      },
    ],
  };
}

function makeDataTransfer(files: File[]) {
  return {
    types: ["Files"],
    items: files.map((f) => ({ kind: "file", type: f.type })),
    files,
    dropEffect: "copy",
    effectAllowed: "all",
  };
}

describe("Import results dialog drag-to-retry", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockImplementation(async ({ data }: { data: { name: string } }) => ({
      ...data,
      id: `id-${data.name}`,
    }));
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.info.mockReset();
    toastMock.warning.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  async function openDialogWithOneFailure() {
    renderSettings();

    const goodFile = makeFile("good.json", JSON.stringify(validArch("Good Arch")));
    const badFile = makeFile("broken.json", "this is not json {");

    const dropzone = screen.getByTestId("dropzone-architectures");
    fireEvent.drop(dropzone, {
      dataTransfer: makeDataTransfer([goodFile, badFile]),
    });

    await screen.findByTestId("dialog-import-results");
    await waitFor(() => {
      expect(screen.getByTestId("row-import-result-0")).toBeTruthy();
      expect(screen.getByTestId("row-import-result-1")).toBeTruthy();
    });

    // Sanity: row 0 succeeded, row 1 failed.
    const row0 = screen.getByTestId("row-import-result-0");
    const row1 = screen.getByTestId("row-import-result-1");
    expect(within(row0).getByText(/Imported as/i)).toBeTruthy();
    expect(within(row1).getByText(/not valid JSON/i)).toBeTruthy();
  }

  it("dropping a corrected JSON file with a matching name flips the failed row to success", async () => {
    await openDialogWithOneFailure();

    const dialog = screen.getByTestId("dialog-import-results");
    const corrected = makeFile(
      "broken.json",
      JSON.stringify(validArch("Fixed Arch")),
    );

    fireEvent.drop(dialog, { dataTransfer: makeDataTransfer([corrected]) });

    // Row 1 (the previously failing entry) flips to success and shows the
    // imported architecture name.
    await waitFor(() => {
      const row1 = screen.getByTestId("row-import-result-1");
      expect(within(row1).queryByText(/not valid JSON/i)).toBeNull();
      expect(within(row1).getByText(/Fixed Arch/)).toBeTruthy();
      expect(within(row1).getByText(/Imported as/i)).toBeTruthy();
    });

    // Row 0 stays as the original success.
    const row0 = screen.getByTestId("row-import-result-0");
    expect(within(row0).getByText(/Good Arch/)).toBeTruthy();

    // The retry pipeline announced success and never flagged any "skipped"
    // files, since the dropped file matched a failing name exactly.
    expect(toastMock.success).toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalledWith(
      expect.stringMatching(/skipped/i),
    );

    // The dialog stayed open after the retry.
    expect(screen.getByTestId("dialog-import-results")).toBeTruthy();
  });

  it("dropping a non-matching JSON file shows a 'skipped' notice and leaves the dialog unchanged", async () => {
    await openDialogWithOneFailure();

    const dialog = screen.getByTestId("dialog-import-results");
    const unrelated = makeFile(
      "unrelated.json",
      JSON.stringify(validArch("Unrelated Arch")),
    );

    // Capture row HTML before the drop so we can verify nothing changed.
    const row0Before = screen.getByTestId("row-import-result-0").innerHTML;
    const row1Before = screen.getByTestId("row-import-result-1").innerHTML;

    fireEvent.drop(dialog, { dataTransfer: makeDataTransfer([unrelated]) });

    // The "skipped" toast fires because no dropped file name matched a failing
    // entry.
    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalledWith(
        expect.stringMatching(/skipped/i),
      );
    });

    // The retry path was not invoked, so upsert isn't called for the unrelated
    // file (only the original successful import counts).
    expect(upsertMock).toHaveBeenCalledTimes(1);

    // Dialog is still open and both rows are byte-for-byte unchanged.
    expect(screen.getByTestId("dialog-import-results")).toBeTruthy();
    expect(screen.getByTestId("row-import-result-0").innerHTML).toBe(row0Before);
    expect(screen.getByTestId("row-import-result-1").innerHTML).toBe(row1Before);
  });
});

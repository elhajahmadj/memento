import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { createMutateAsync, updateMutateAsync, deleteMutate, listMockData } =
  vi.hoisted(() => ({
    createMutateAsync: vi.fn(),
    updateMutateAsync: vi.fn(),
    deleteMutate: vi.fn(),
    listMockData: { current: [] as unknown[] },
  }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useGetCurrentProject: () => ({
      data: { project: { solutionName: "ProjA" } },
      isLoading: false,
    }),
    useListRouteMocks: () => ({
      data: { mocks: listMockData.current },
      isLoading: false,
    }),
    useCreateRouteMock: () => ({
      mutateAsync: createMutateAsync,
      isPending: false,
    }),
    useUpdateRouteMock: () => ({
      mutateAsync: updateMutateAsync,
      mutate: updateMutateAsync,
      isPending: false,
    }),
    useDeleteRouteMock: () => ({
      mutate: deleteMutate,
      isPending: false,
    }),
    getListRouteMocksQueryKey: () => ["route-mocks", "ProjA"],
  };
});

import { MocksSection } from "../mocks-section";

function renderUI() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MocksSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMutateAsync.mockReset().mockResolvedValue({});
  updateMutateAsync.mockReset().mockResolvedValue({});
  deleteMutate.mockReset();
  listMockData.current = [];
});

afterEach(() => cleanup());

describe("<MocksSection />", () => {
  it("shows the empty-state hint when no mocks exist", () => {
    renderUI();
    expect(screen.getByTestId("section-mocks")).toBeTruthy();
    expect(screen.getByTestId("text-no-mocks")).toBeTruthy();
  });

  it("opens the add dialog and submits a new mock", async () => {
    renderUI();
    fireEvent.click(screen.getByTestId("button-add-mock"));
    const dialog = await screen.findByTestId("dialog-edit-mock");
    fireEvent.change(within(dialog).getByTestId("input-mock-name"), {
      target: { value: "stub me" },
    });
    fireEvent.change(within(dialog).getByTestId("input-mock-url"), {
      target: { value: "**/api/users/me" },
    });
    fireEvent.change(within(dialog).getByTestId("input-mock-status"), {
      target: { value: "201" },
    });
    fireEvent.change(within(dialog).getByTestId("input-mock-body"), {
      target: { value: '{"id":"u1"}' },
    });
    fireEvent.click(within(dialog).getByTestId("button-save-mock"));

    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(createMutateAsync).toHaveBeenCalledWith({
      data: {
        projectName: "ProjA",
        name: "stub me",
        method: "GET",
        urlPattern: "**/api/users/me",
        status: 201,
        bodyJson: { id: "u1" },
        enabled: true,
      },
    });
  });

  it("renders existing mocks and allows toggling their enabled flag", () => {
    listMockData.current = [
      {
        id: "m1",
        name: "live-mock",
        method: "GET",
        urlPattern: "**/api/x",
        status: 200,
        bodyJson: null,
        enabled: true,
      },
    ];
    renderUI();
    expect(screen.getByTestId("row-mock-m1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-delete-mock-m1"));
    expect(deleteMutate).toHaveBeenCalledWith({ id: "m1" });
  });
});

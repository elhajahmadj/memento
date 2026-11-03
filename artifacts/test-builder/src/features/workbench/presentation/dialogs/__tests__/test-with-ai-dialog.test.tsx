/**
 * Component-level tests for <TestWithAiDialog />: default selection,
 * ignore-checkbox toggling the reason field, submit-disabled-when-
 * ignore-but-reason-empty, and the request body shape posted by the
 * mutation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { startMutate } = vi.hoisted(() => ({ startMutate: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => {
  const inertQuery = () => ({
    data: { root: { type: "folder", name: "/", path: "/", children: [] } },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    useDiscoverProjectTests: inertQuery,
    getDiscoverProjectTestsQueryKey: () => ["discover-project-tests"],
    useStartAiAgentRun: () => ({
      mutate: (vars: unknown) => {
        startMutate(vars);
      },
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

import { TestWithAiDialog } from "../test-with-ai-dialog";

beforeEach(() => {
  startMutate.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderDialog() {
  return render(
    <TestWithAiDialog
      open
      onOpenChange={() => {}}
      projectName="DemoProject"
      defaultLanguage="csharp"
    />,
  );
}

describe("<TestWithAiDialog />", () => {
  it("defaults to 'New [Test] method' for the target-method radio group", () => {
    renderDialog();
    const testRadio = screen.getByTestId("radio-ai-method-test");
    expect(testRadio.getAttribute("data-state")).toBe("checked");
    expect(
      screen.getByTestId("radio-ai-method-before-each").getAttribute("data-state"),
    ).toBe("unchecked");
    expect(
      screen
        .getByTestId("radio-ai-method-one-time-set-up")
        .getAttribute("data-state"),
    ).toBe("unchecked");
  });

  it("shows the reason field only when 'Ignore this test' is checked", () => {
    renderDialog();
    expect(screen.queryByTestId("input-ai-ignore-reason")).toBeNull();
    fireEvent.click(screen.getByTestId("checkbox-ai-ignore"));
    expect(screen.getByTestId("input-ai-ignore-reason")).toBeTruthy();
  });

  it("disables submit when ignore is checked but the reason is empty", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("input-ai-suite-name"), {
      target: { value: "LoginSmoke" },
    });
    fireEvent.change(screen.getByTestId("textarea-ai-plan"), {
      target: { value: "1. Open the login page" },
    });
    const submit = screen.getByTestId("button-ai-start-run") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(screen.getByTestId("checkbox-ai-ignore"));
    expect(
      (screen.getByTestId("button-ai-start-run") as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId("input-ai-ignore-reason"), {
      target: { value: "Flaky on CI" },
    });
    expect(
      (screen.getByTestId("button-ai-start-run") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("posts the new fields (targetMethod, ignore, ignoreReason) on submit", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("input-ai-suite-name"), {
      target: { value: "LoginSmoke" },
    });
    fireEvent.change(screen.getByTestId("textarea-ai-plan"), {
      target: { value: "1. Open the login page" },
    });
    fireEvent.click(screen.getByTestId("radio-ai-method-before-each"));
    fireEvent.click(screen.getByTestId("checkbox-ai-ignore"));
    fireEvent.change(screen.getByTestId("input-ai-ignore-reason"), {
      target: { value: "Flaky on CI" },
    });
    fireEvent.click(screen.getByTestId("button-ai-start-run"));
    expect(startMutate).toHaveBeenCalledTimes(1);
    const vars = startMutate.mock.calls[0]![0] as {
      projectName: string;
      data: {
        kind: string;
        suiteName: string;
        plan: string;
        language: string;
        targetMode: string;
        targetMethod: string;
        ignore: boolean;
        ignoreReason: string | null;
      };
    };
    expect(vars.projectName).toBe("DemoProject");
    expect(vars.data.targetMethod).toBe("beforeEach");
    expect(vars.data.ignore).toBe(true);
    expect(vars.data.ignoreReason).toBe("Flaky on CI");
    expect(vars.data.targetMode).toBe("new_suite");
    expect(vars.data.suiteName).toBe("LoginSmoke");
  });

  it("disables the Category input when a setup hook is selected and posts category=null", () => {
    renderDialog();
    const category = screen.getByTestId("input-ai-category") as HTMLInputElement;
    expect(category.disabled).toBe(false);
    fireEvent.change(category, { target: { value: "smoke" } });
    expect(category.value).toBe("smoke");

    // Switching to a hook target must disable the field, clear its
    // visible value, and surface the "categories only apply to [Test]"
    // hint.
    fireEvent.click(screen.getByTestId("radio-ai-method-before-each"));
    const categoryAfter = screen.getByTestId(
      "input-ai-category",
    ) as HTMLInputElement;
    expect(categoryAfter.disabled).toBe(true);
    expect(categoryAfter.value).toBe("");
    expect(screen.getByTestId("hint-ai-category-disabled")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-ai-suite-name"), {
      target: { value: "LoginSmoke" },
    });
    fireEvent.change(screen.getByTestId("textarea-ai-plan"), {
      target: { value: "1. Open the login page" },
    });
    fireEvent.click(screen.getByTestId("button-ai-start-run"));
    const vars = startMutate.mock.calls[0]![0] as {
      data: { targetMethod: string; category: string | null };
    };
    expect(vars.data.targetMethod).toBe("beforeEach");
    expect(vars.data.category).toBeNull();
  });

  it("posts targetMethod='test' and ignore=false by default", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("input-ai-suite-name"), {
      target: { value: "LoginSmoke" },
    });
    fireEvent.change(screen.getByTestId("textarea-ai-plan"), {
      target: { value: "1. Open the login page" },
    });
    fireEvent.click(screen.getByTestId("button-ai-start-run"));
    const vars = startMutate.mock.calls[0]![0] as {
      data: { targetMethod: string; ignore: boolean; ignoreReason: string | null };
    };
    expect(vars.data.targetMethod).toBe("test");
    expect(vars.data.ignore).toBe(false);
    expect(vars.data.ignoreReason).toBeNull();
  });
});

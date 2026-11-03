import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project } from "@/features/projects/infrastructure/projectService";
import type { RecordedAction } from "@/features/codegen/domain/types";

// Mock the adapter dispatch so we can deterministically observe both
// the happy path (orchestrator returns ok) and the error path
// (orchestrator wraps a thrown adapter error as infrastructure AppError)
// without depending on a real on-disk emitter run.
const generateSuiteFilesMock = vi.fn();
vi.mock("@/features/codegen/infrastructure/codegenAdapter", () => ({
  generateSuiteFiles: (...args: unknown[]) => generateSuiteFilesMock(...args),
}));

// Imported AFTER the vi.mock above so the use-case binds to the mocked
// adapter, not the real one.
const { generateTest } = await import(
  "@/features/codegen/application/useCases/generateTest"
);

function makeProject(rootPath: string): Project {
  return {
    solutionName: "Sln",
    testProjectName: "Tests.Project",
    namespace: "Acme",
    rootPath,
    slnPath: path.join(rootPath, "Sln.sln"),
    language: "csharp",
  };
}

describe("generateTest use case (orchestrator)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "gen-test-uc-"));
    generateSuiteFilesMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns ok with the adapter's SuiteGenerationResult on success", async () => {
    const project = makeProject(tmp);
    const fakeResult = {
      selectorsPath: "Tests.Project/Tests/Smoke/SmokeSelectors.cs",
      interfacePath: "Tests.Project/Tests/Smoke/ISmokeActions.cs",
      actionsPath: "Tests.Project/Tests/Smoke/SmokeActions.cs",
      methodNames: new Map<RecordedAction, string>(),
      takesValueByMethod: new Map<string, boolean>(),
    };
    generateSuiteFilesMock.mockResolvedValueOnce(fakeResult);

    const actions: RecordedAction[] = [
      { type: "navigate", url: "https://example.com" },
    ];
    const result = await generateTest({
      project,
      suiteName: "Smoke",
      actions,
    });

    expect(generateSuiteFilesMock).toHaveBeenCalledExactlyOnceWith(
      project,
      "Smoke",
      actions,
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value).toBe(fakeResult);
    }
  });

  it("wraps a thrown adapter error as an infrastructure AppError", async () => {
    const project = makeProject(tmp);
    generateSuiteFilesMock.mockRejectedValueOnce(new Error("disk on fire"));

    const result = await generateTest({
      project,
      suiteName: "Smoke",
      actions: [{ type: "navigate", url: "https://example.com" }],
    });

    expect(result.kind).toBe("err");
    if (result.kind === "err") {
      expect(result.error.kind).toBe("infrastructure");
      expect(result.error.message).toContain("disk on fire");
      expect(result.error.cause).toBeInstanceOf(Error);
    }
  });
});

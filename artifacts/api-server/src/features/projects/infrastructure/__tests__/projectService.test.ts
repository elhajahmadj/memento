import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  createProject,
  loadProject,
  setCurrentProject,
} from "@/features/projects/infrastructure/projectService";
import {
  DEFAULT_ARCHITECTURE_ID,
  architecturesComposition,
  type Architecture,
} from "@/features/architectures/infrastructure/architectureService";

async function upsertArchitecture(arch: Architecture): Promise<Architecture> {
  const r = await architecturesComposition.upsert.execute(arch);
  if (r.kind === "err") throw new Error(r.error.message);
  return r.value;
}

let tmp: string;
let originalWorkspace: string;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-projsvc-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  setCurrentProject(null);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("createProject with the built-in Default architecture", () => {
  it("scaffolds the expected three-project layout matching the legacy template", async () => {
    const project = await createProject({
      solutionName: "AcmeSln",
      namespace: "Acme.QA",
    });

    expect(project.solutionName).toBe("AcmeSln");
    expect(project.namespace).toBe("Acme.QA");
    expect(project.testProjectName).toBe("AcmeSln.Tests");
    expect(project.rootPath).toBe(path.join(tmp, "AcmeSln"));
    expect(project.slnPath).toBe(path.join(tmp, "AcmeSln", "AcmeSln.sln"));

    const root = project.rootPath;

    // Solution file references each project with its csproj.
    const sln = await fs.readFile(project.slnPath, "utf8");
    for (const name of [
      "AcmeSln.Shared",
      "AcmeSln.Infrastructure",
      "AcmeSln.Tests",
    ]) {
      expect(sln).toContain(`"${name}", "${name}\\${name}.csproj"`);
    }
    expect(sln).toContain("Microsoft Visual Studio Solution File");

    // Each project folder + its csproj exists.
    for (const name of [
      "AcmeSln.Shared",
      "AcmeSln.Infrastructure",
      "AcmeSln.Tests",
    ]) {
      expect(await exists(path.join(root, name, `${name}.csproj`))).toBe(true);
    }

    // Default-architecture canonical files.
    expect(
      await exists(
        path.join(root, "AcmeSln.Shared", "Helpers", "TestContextHelper.cs"),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeSln.Infrastructure",
          "Fixtures",
          "TestFixtureBase.cs",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeSln.Infrastructure",
          "Interfaces",
          "IBrowserManager.cs",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(path.join(root, "AcmeSln.Tests", "appsettings.json")),
    ).toBe(true);

    // Empty Tests folder gets a .gitkeep so it survives in source control.
    expect(
      await exists(path.join(root, "AcmeSln.Tests", "Tests", ".gitkeep")),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeSln.Tests",
          "PageObjects",
          "Selectors",
          ".gitkeep",
        ),
      ),
    ).toBe(true);

    // {{Solution}} tokens in csproj content are substituted with the
    // chosen solution name.
    const infraCsproj = await fs.readFile(
      path.join(root, "AcmeSln.Infrastructure", "AcmeSln.Infrastructure.csproj"),
      "utf8",
    );
    expect(infraCsproj).toContain(
      "..\\AcmeSln.Shared\\AcmeSln.Shared.csproj",
    );
    expect(infraCsproj).not.toContain("{{Solution}}");

    // Marker file is written and reflects the architecture choice.
    const marker = JSON.parse(
      await fs.readFile(path.join(root, ".testbuilder.json"), "utf8"),
    );
    expect(marker).toEqual({
      architectureId: DEFAULT_ARCHITECTURE_ID,
      testProjectName: "AcmeSln.Tests",
      namespace: "Acme.QA",
      solutionName: "AcmeSln",
      // The marker now records language so we can rehydrate the project
      // type without consulting the architecture file later.
      language: "csharp",
    });

    // C# scaffolds open in Visual Studio via .sln + .csproj — they
    // intentionally do NOT ship a `.vscode/` folder. The Python and
    // Node.js scaffolds do (Task #32). Guard against an accidental
    // regression that would add `.vscode/` to every architecture.
    expect(await exists(path.join(root, ".vscode"))).toBe(false);
    for (const proj of [
      "AcmeSln.Shared",
      "AcmeSln.Infrastructure",
      "AcmeSln.Tests",
    ]) {
      expect(await exists(path.join(root, proj, ".vscode"))).toBe(false);
    }
  });

  it("rejects invalid solution and namespace identifiers", async () => {
    await expect(
      createProject({ solutionName: "1bad", namespace: "Acme" }),
    ).rejects.toThrow(/solution/i);
    await expect(
      createProject({ solutionName: "Good", namespace: "9bad" }),
    ).rejects.toThrow(/namespace/i);
  });

  it("throws when an unknown architecture id is requested", async () => {
    await expect(
      createProject({
        solutionName: "X",
        namespace: "Acme",
        architectureId: "does-not-exist",
      }),
    ).rejects.toThrow(/Architecture not found/);
  });
});

describe("createProject with a custom architecture", () => {
  it("writes the expected files for multiple projects, nested folders, and token substitution", async () => {
    const customArch: Architecture = {
      id: "custom-1",
      name: "CustomArch",
      isBuiltIn: false,
      projects: [
        {
          id: "p-core",
          nameSuffix: ".Core",
          isTestsProject: false,
          slnGuid: "{11111111-1111-1111-1111-111111111111}",
          // Intentionally no .csproj entry — scaffolder should auto-generate one.
          files: [
            {
              name: "Greeting.cs",
              content:
                "namespace {{Namespace}}.Core; public static class Greeting { public const string Sln = \"{{Solution}}\"; }",
            },
          ],
          folders: [
            {
              name: "Models",
              folders: [
                {
                  name: "Internal",
                  folders: [],
                  files: [
                    {
                      name: "Widget.cs",
                      content:
                        "namespace {{Namespace}}.Core.Models.Internal; public class Widget {}",
                    },
                  ],
                },
              ],
              files: [
                {
                  name: "Thing.cs",
                  content:
                    "namespace {{Namespace}}.Core.Models; public class Thing {}",
                },
              ],
            },
          ],
        },
        {
          id: "p-tests",
          nameSuffix: ".QaTests",
          isTestsProject: true,
          slnGuid: "{22222222-2222-2222-2222-222222222222}",
          files: [
            {
              // Token in file name itself — should also be substituted.
              name: "{{Solution}}.QaTests.csproj",
              content:
                "<Project><ItemGroup><ProjectReference Include=\"..\\{{Solution}}.Core\\{{Solution}}.Core.csproj\" /></ItemGroup></Project>",
            },
          ],
          folders: [],
        },
      ],
    };
    const stored = await upsertArchitecture(customArch);

    const project = await createProject({
      solutionName: "Foo",
      namespace: "Foo.Bar",
      architectureId: stored.id,
    });

    expect(project.testProjectName).toBe("Foo.QaTests");
    const root = project.rootPath;

    // Auto-generated csproj for the project that didn't include one.
    const coreCsproj = await fs.readFile(
      path.join(root, "Foo.Core", "Foo.Core.csproj"),
      "utf8",
    );
    expect(coreCsproj).toContain("<TargetFramework>net8.0</TargetFramework>");

    // {{Namespace}} / {{Solution}} substituted in file content.
    const greeting = await fs.readFile(
      path.join(root, "Foo.Core", "Greeting.cs"),
      "utf8",
    );
    expect(greeting).toContain("namespace Foo.Bar.Core;");
    expect(greeting).toContain('"Foo"');
    expect(greeting).not.toContain("{{Namespace}}");
    expect(greeting).not.toContain("{{Solution}}");

    // Nested folders are created and their files are written with token
    // substitution.
    const widget = await fs.readFile(
      path.join(root, "Foo.Core", "Models", "Internal", "Widget.cs"),
      "utf8",
    );
    expect(widget).toContain("namespace Foo.Bar.Core.Models.Internal;");
    const thing = await fs.readFile(
      path.join(root, "Foo.Core", "Models", "Thing.cs"),
      "utf8",
    );
    expect(thing).toContain("namespace Foo.Bar.Core.Models;");

    // File name token substitution and contents.
    const testsCsproj = await fs.readFile(
      path.join(root, "Foo.QaTests", "Foo.QaTests.csproj"),
      "utf8",
    );
    expect(testsCsproj).toContain(
      "..\\Foo.Core\\Foo.Core.csproj",
    );
    expect(testsCsproj).not.toContain("{{Solution}}");

    // Solution file references both projects with the solution-prefixed names.
    const sln = await fs.readFile(project.slnPath, "utf8");
    expect(sln).toContain('"Foo.Core", "Foo.Core\\Foo.Core.csproj"');
    expect(sln).toContain(
      '"Foo.QaTests", "Foo.QaTests\\Foo.QaTests.csproj"',
    );
    expect(sln).toContain("{11111111-1111-1111-1111-111111111111}");
    expect(sln).toContain("{22222222-2222-2222-2222-222222222222}");

    // Marker records the custom architecture id and tests project name.
    const marker = JSON.parse(
      await fs.readFile(path.join(root, ".testbuilder.json"), "utf8"),
    );
    expect(marker.architectureId).toBe(stored.id);
    expect(marker.testProjectName).toBe("Foo.QaTests");
    expect(marker.namespace).toBe("Foo.Bar");
    expect(marker.solutionName).toBe("Foo");
  });
});

describe("detectProjectInfo via loadProject", () => {
  it("reads project info from the .testbuilder.json marker when present", async () => {
    // Scaffold a project (writes the marker), then load it back.
    const created = await createProject({
      solutionName: "MarkerSln",
      namespace: "Marker.Ns",
    });
    setCurrentProject(null);

    const loaded = await loadProject(created.slnPath);
    expect(loaded).toEqual({
      solutionName: "MarkerSln",
      testProjectName: "MarkerSln.Tests",
      namespace: "Marker.Ns",
      rootPath: created.rootPath,
      slnPath: created.slnPath,
      // Marker without an explicit `language` is normalized to the
      // legacy default ("csharp") on load.
      language: "csharp",
      // Marker without an explicit `solutionType` is normalized to
      // the default ("playwright") on load so downstream code can
      // safely read `project.solutionType` unconditionally.
      solutionType: "playwright",
    });
  });

  it("respects a marker that designates a non-default tests project name", async () => {
    const created = await createProject({
      solutionName: "MarkerSln",
      namespace: "Marker.Ns",
    });
    // Overwrite marker to simulate a custom layout where tests project is
    // named differently than the default convention.
    await fs.writeFile(
      path.join(created.rootPath, ".testbuilder.json"),
      JSON.stringify({
        architectureId: "custom-x",
        testProjectName: "MarkerSln.QaTests",
        namespace: "Other.Ns",
        solutionName: "MarkerSln",
      }),
    );
    setCurrentProject(null);

    const loaded = await loadProject(created.slnPath);
    expect(loaded.testProjectName).toBe("MarkerSln.QaTests");
    expect(loaded.namespace).toBe("Other.Ns");
  });

  it("falls back to the default layout heuristic for legacy projects without a marker", async () => {
    // Build a legacy-style project on disk by hand: solution + Infrastructure
    // project containing a TestFixtureBase.cs that reveals the namespace.
    const root = path.join(tmp, "LegacySln");
    await fs.mkdir(
      path.join(root, "LegacySln.Infrastructure", "Fixtures"),
      { recursive: true },
    );
    const slnPath = path.join(root, "LegacySln.sln");
    await fs.writeFile(slnPath, "Microsoft Visual Studio Solution File\n");
    await fs.writeFile(
      path.join(
        root,
        "LegacySln.Infrastructure",
        "Fixtures",
        "TestFixtureBase.cs",
      ),
      "namespace Legacy.Detected.Infrastructure.Fixtures;\npublic class TestFixtureBase {}\n",
    );

    const loaded = await loadProject(slnPath);
    expect(loaded).toEqual({
      solutionName: "LegacySln",
      testProjectName: "LegacySln.Tests",
      namespace: "Legacy.Detected",
      rootPath: root,
      slnPath,
      // Marker-less legacy projects always look like csharp by definition
      // (.sln is csharp; .pyproject.toml is python).
      language: "csharp",
      solutionType: "playwright",
    });
  });

  it("falls back to the solution name as namespace when no heuristic file is present", async () => {
    const root = path.join(tmp, "BareSln");
    await fs.mkdir(root, { recursive: true });
    const slnPath = path.join(root, "BareSln.sln");
    await fs.writeFile(slnPath, "Microsoft Visual Studio Solution File\n");

    const loaded = await loadProject(slnPath);
    expect(loaded.solutionName).toBe("BareSln");
    expect(loaded.testProjectName).toBe("BareSln.Tests");
    expect(loaded.namespace).toBe("BareSln");
  });

  it("rejects loading a solution outside the workspace folder", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "rec-outside-"));
    try {
      const slnPath = path.join(outside, "X.sln");
      await fs.writeFile(slnPath, "");
      await expect(loadProject(slnPath)).rejects.toThrow(/workspace/i);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("createProject with a custom API architecture (Option A)", () => {
  it("scaffolds via the generic scaffolder and stamps the marker as solutionType=api", async () => {
    const apiArch: Architecture = {
      id: "my-api-arch",
      name: "My API",
      isBuiltIn: false,
      language: "csharp",
      solutionType: "api",
      projects: [
        {
          id: "tests",
          nameSuffix: ".ApiTests",
          isTestsProject: true,
          slnGuid: "{00000000-0000-0000-0000-0000000000c1}",
          files: [
            {
              name: "SmokeTest.cs",
              content:
                "namespace {{Namespace}}.ApiTests; public class SmokeTest { public const string Sln = \"{{Solution}}\"; }",
            },
          ],
          folders: [],
        },
      ],
    };
    await upsertArchitecture(apiArch);

    const project = await createProject({
      solutionName: "ApiSln",
      namespace: "Acme.QA",
      architectureId: "my-api-arch",
      language: "csharp",
      solutionType: "api",
    });

    expect(project.solutionType).toBe("api");
    expect(project.testProjectName).toBe("ApiSln.ApiTests");
    expect(project.slnPath).toBe(path.join(tmp, "ApiSln", "ApiSln.sln"));

    // The user's custom file was scaffolded with token substitution.
    const tested = await fs.readFile(
      path.join(project.rootPath, "ApiSln.ApiTests", "SmokeTest.cs"),
      "utf8",
    );
    expect(tested).toContain("namespace Acme.QA.ApiTests;");
    expect(tested).toContain('"ApiSln"');

    // Marker reflects the user's chosen architecture id and the API flavor.
    const marker = JSON.parse(
      await fs.readFile(
        path.join(project.rootPath, ".testbuilder.json"),
        "utf8",
      ),
    );
    expect(marker).toEqual({
      architectureId: "my-api-arch",
      testProjectName: "ApiSln.ApiTests",
      namespace: "Acme.QA",
      solutionName: "ApiSln",
      language: "csharp",
      solutionType: "api",
    });

    // loadProject reads the marker back as an API project so the
    // workbench routes Build Test → AssistantBuilder.
    const reloaded = await loadProject(project.slnPath);
    expect(reloaded.solutionType).toBe("api");
  });

  it("rejects a Playwright architecture passed in for an API solution", async () => {
    const playwrightArch: Architecture = {
      id: "wrong-flavor",
      name: "Playwright Layout",
      isBuiltIn: false,
      language: "csharp",
      solutionType: "playwright",
      projects: [
        {
          id: "tests",
          nameSuffix: ".Tests",
          isTestsProject: true,
          slnGuid: "{00000000-0000-0000-0000-0000000000c2}",
          files: [],
          folders: [],
        },
      ],
    };
    await upsertArchitecture(playwrightArch);

    await expect(
      createProject({
        solutionName: "WrongFlavor",
        namespace: "Acme",
        architectureId: "wrong-flavor",
        language: "csharp",
        solutionType: "api",
      }),
    ).rejects.toThrow(/not an API architecture/i);
  });

  it("rejects when the chosen architecture targets a different language", async () => {
    const pyArch: Architecture = {
      id: "api-py-layout",
      name: "Python API",
      isBuiltIn: false,
      language: "python",
      solutionType: "api",
      projects: [
        {
          id: "tests",
          nameSuffix: ".ApiTests",
          isTestsProject: true,
          slnGuid: "{00000000-0000-0000-0000-0000000000c3}",
          files: [],
          folders: [],
        },
      ],
    };
    await upsertArchitecture(pyArch);

    await expect(
      createProject({
        solutionName: "MismatchSln",
        namespace: "Acme",
        architectureId: "api-py-layout",
        language: "csharp",
        solutionType: "api",
      }),
    ).rejects.toThrow(/language python does not match/i);
  });

  it("falls back to the built-in scaffolder when a per-language built-in API id is selected", async () => {
    const project = await createProject({
      solutionName: "BuiltInApi",
      namespace: "Acme",
      architectureId: "api-default-csharp",
      language: "csharp",
      solutionType: "api",
    });
    expect(project.solutionType).toBe("api");
    // Marker records the per-language built-in id (not the legacy
    // "api-default") so the UI can later display the chosen built-in.
    const marker = JSON.parse(
      await fs.readFile(
        path.join(project.rootPath, ".testbuilder.json"),
        "utf8",
      ),
    );
    expect(marker.architectureId).toBe("api-default-csharp");
    expect(marker.solutionType).toBe("api");
  });
});

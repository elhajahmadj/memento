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
import { JAVA_DEFAULT_ARCHITECTURE_ID } from "@/features/architectures/infrastructure/architectureService";

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-javascaff-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;
  setCurrentProject(null);
});

afterEach(async () => {
  recorderConfig.workspaceDir = originalWorkspace;
  setCurrentProject(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("createProject with java-default architecture", () => {
  it("emits a Maven multi-module tree with pom.xml as the project marker", async () => {
    const project = await createProject({
      solutionName: "AcmeJava",
      namespace: "ignored.for.java",
      language: "java",
    });

    expect(project.language).toBe("java");
    expect(project.solutionName).toBe("AcmeJava");
    // `AcmeJava` → flat lowercase Java package `acmejava`. Namespace
    // mirrors that so generated `package acmejava.tests;` lines line
    // up with the on-disk `src/test/java/acmejava/...` layout.
    expect(project.namespace).toBe("acmejava");
    // Tests module is suffixed `-tests` (mirrors the C# `.Tests` suffix
    // and the Python tests-package convention).
    expect(project.testProjectName).toBe("AcmeJava-tests");
    expect(project.rootPath).toBe(path.join(tmp, "AcmeJava"));
    // Java projects re-use `slnPath` to point at the parent pom so the
    // rest of the API surface (which keys projects by slnPath) keeps
    // working unchanged.
    expect(project.slnPath).toBe(path.join(tmp, "AcmeJava", "pom.xml"));

    const root = project.rootPath;

    // Parent pom + per-module Maven layout.
    expect(await exists(path.join(root, "pom.xml"))).toBe(true);
    expect(await exists(path.join(root, "AcmeJava-shared", "pom.xml"))).toBe(
      true,
    );
    expect(
      await exists(path.join(root, "AcmeJava-infrastructure", "pom.xml")),
    ).toBe(true);
    expect(await exists(path.join(root, "AcmeJava-tests", "pom.xml"))).toBe(
      true,
    );

    // The parent pom must reference each child module by name so a
    // top-level `mvn` invocation builds the whole project.
    const parentPom = await fs.readFile(
      path.join(root, "pom.xml"),
      "utf8",
    );
    expect(parentPom).toContain("<module>AcmeJava-shared</module>");
    expect(parentPom).toContain("<module>AcmeJava-infrastructure</module>");
    expect(parentPom).toContain("<module>AcmeJava-tests</module>");
    expect(parentPom).toContain("<artifactId>AcmeJava</artifactId>");

    // Java source roots — the package segment is the lowercase
    // `javaPackageName(solutionName)` token expanded by the scaffolder.
    expect(
      await exists(
        path.join(root, "AcmeJava-shared", "src", "main", "java", "acmejava"),
      ),
    ).toBe(true);
    // The shared module no longer ships a `Constants.java` — recorded
    // constants now live in per-suite `<Suite>Constants.java` files
    // emitted into the tests module's `constants/` subpackage.
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-shared",
          "src",
          "main",
          "java",
          "acmejava",
          "Constants.java",
        ),
      ),
    ).toBe(false);
    // Per-suite constants/ + testcategories/ folders exist as siblings
    // of `tests/` and `pages/` so the recorder can drop new files in
    // without re-scaffolding.
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-tests",
          "src",
          "test",
          "java",
          "acmejava",
          "constants",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-tests",
          "src",
          "test",
          "java",
          "acmejava",
          "testcategories",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-tests",
          "src",
          "test",
          "java",
          "acmejava",
          "tests",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-tests",
          "src",
          "test",
          "java",
          "acmejava",
          "pages",
          "selectors",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-tests",
          "src",
          "test",
          "java",
          "acmejava",
          "pages",
          "actions",
        ),
      ),
    ).toBe(true);

    // Tests module ships a .gitignore + .env.example + README so the
    // freshly scaffolded project is immediately runnable.
    expect(
      await exists(path.join(root, "AcmeJava-tests", ".gitignore")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "AcmeJava-tests", ".env.example")),
    ).toBe(true);
    expect(
      await exists(path.join(root, "AcmeJava-tests", "README.md")),
    ).toBe(true);

    // Shared module ships an empty `pages/interfaces/` folder so
    // recorded `I<Suite>Actions` interfaces have a home that other
    // Maven modules can depend on (mirrors the C# layout).
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-shared",
          "src",
          "main",
          "java",
          "acmejava",
          "pages",
          "interfaces",
        ),
      ),
    ).toBe(true);

    // Shared module ships AppConfiguration + TestOutputLogger so the
    // infrastructure layer can read env vars and emit diagnostics.
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-shared",
          "src",
          "main",
          "java",
          "acmejava",
          "AppConfiguration.java",
        ),
      ),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          root,
          "AcmeJava-shared",
          "src",
          "main",
          "java",
          "acmejava",
          "TestOutputLogger.java",
        ),
      ),
    ).toBe(true);

    // Infrastructure module ships BrowserManager + TestFixtureBase +
    // BrowserLifecycleExtension so generated tests have a working
    // browser/page lifecycle and screenshot-on-failure out of the box.
    const infraJavaRoot = path.join(
      root,
      "AcmeJava-infrastructure",
      "src",
      "main",
      "java",
      "acmejava",
      "infrastructure",
    );
    expect(
      await exists(path.join(infraJavaRoot, "BrowserManager.java")),
    ).toBe(true);
    expect(
      await exists(path.join(infraJavaRoot, "fixtures", "TestFixtureBase.java")),
    ).toBe(true);
    expect(
      await exists(
        path.join(infraJavaRoot, "fixtures", "BrowserLifecycleExtension.java"),
      ),
    ).toBe(true);

    // TestFixtureBase must declare protected `page`/`context` fields the
    // generated test classes inherit, plus the JUnit 5 @BeforeEach hook
    // that initializes them from BrowserManager.
    const fixtureBase = await fs.readFile(
      path.join(infraJavaRoot, "fixtures", "TestFixtureBase.java"),
      "utf8",
    );
    expect(fixtureBase).toContain("protected Page page;");
    expect(fixtureBase).toContain("@BeforeEach");
    expect(fixtureBase).toContain("page = browserManager.newPage(context);");

    // Tests module ships a sample ExampleTest so `mvn test` has at
    // least one runnable JUnit class out of the box.
    const exampleTest = await fs.readFile(
      path.join(
        root,
        "AcmeJava-tests",
        "src",
        "test",
        "java",
        "acmejava",
        "tests",
        "ExampleTest.java",
      ),
      "utf8",
    );
    expect(exampleTest).toContain("extends TestFixtureBase");
    expect(exampleTest).toContain("@Test");

    // Parent pom must ship dependencyManagement entries for the new
    // dependencies (dotenv-java, junit-jupiter-api) and the surefire
    // plugin pinned in pluginManagement.
    expect(parentPom).toContain("<artifactId>dotenv-java</artifactId>");
    expect(parentPom).toContain("<artifactId>junit-jupiter-api</artifactId>");
    expect(parentPom).toContain("<artifactId>maven-surefire-plugin</artifactId>");

    // Top-level `.vscode/` IDE config (settings + launch + extensions),
    // emitted synthetically by the scaffolder rather than baked into the
    // architecture because it lives next to the parent pom — not inside
    // any one Maven module.
    const settingsPath = path.join(root, ".vscode", "settings.json");
    const launchPath = path.join(root, ".vscode", "launch.json");
    const extensionsPath = path.join(root, ".vscode", "extensions.json");
    expect(await exists(settingsPath)).toBe(true);
    expect(await exists(launchPath)).toBe(true);
    expect(await exists(extensionsPath)).toBe(true);

    const launch = JSON.parse(await fs.readFile(launchPath, "utf8"));
    expect(Array.isArray(launch.configurations)).toBe(true);
    // The launch config must point at the tests Maven module so the
    // VS Code Java debugger can find JUnit tests by project name.
    expect(launch.configurations[0].projectName).toBe("AcmeJava-tests");
    expect(launch.configurations[0].type).toBe("java");

    const extensions = JSON.parse(await fs.readFile(extensionsPath, "utf8"));
    expect(extensions.recommendations).toContain(
      "vscjava.vscode-java-pack",
    );
    expect(extensions.recommendations).toContain(
      "ms-playwright.playwright",
    );

    // Marker stores language so a re-load picks the right code path.
    const marker = JSON.parse(
      await fs.readFile(path.join(root, ".testbuilder.json"), "utf8"),
    );
    expect(marker.language).toBe("java");
    expect(marker.architectureId).toBe(JAVA_DEFAULT_ARCHITECTURE_ID);
    expect(marker.namespace).toBe("acmejava");
    expect(marker.testProjectName).toBe("AcmeJava-tests");
  });

  it("rehydrates language: 'java' when re-loaded from disk", async () => {
    const created = await createProject({
      solutionName: "AcmeJava",
      namespace: "ignored",
      language: "java",
    });
    setCurrentProject(null);

    const reloaded = await loadProject(created.slnPath);
    expect(reloaded.language).toBe("java");
    expect(reloaded.solutionName).toBe("AcmeJava");
    expect(reloaded.namespace).toBe("acmejava");
    expect(reloaded.testProjectName).toBe("AcmeJava-tests");
    expect(reloaded.rootPath).toBe(created.rootPath);
  });

  it("derives a markerless Java project from its directory name", async () => {
    // Scaffold first, then delete the marker to simulate a Java
    // project that was checked into version control without the
    // recorder's `.testbuilder.json` (e.g. cloned from a teammate).
    const created = await createProject({
      solutionName: "AcmeJava",
      namespace: "ignored",
      language: "java",
    });
    await fs.rm(path.join(created.rootPath, ".testbuilder.json"));
    setCurrentProject(null);

    const reloaded = await loadProject(created.slnPath);
    expect(reloaded.language).toBe("java");
    expect(reloaded.solutionName).toBe("AcmeJava");
    expect(reloaded.namespace).toBe("acmejava");
    expect(reloaded.testProjectName).toBe("AcmeJava-tests");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Java + Maven toolchain detection
// ---------------------------------------------------------------------------
//
// This is the only end-to-end check that the recorder's Java codegen
// produces source that actually compiles. The string-level unit tests in
// `javaCodegen.test.ts` will keep passing if `javaCodegen` ever drifts
// (extra semicolons, missing imports, escaped quotes); a real `javac`
// pass via `mvn test-compile` is what catches that drift.
//
// Skipped cleanly when `mvn` or a JDK 17+ `javac` isn't on PATH so it
// stays a no-op on contributor machines / CI runners that don't ship a
// Java toolchain.
function detectJavaToolchain(): { available: boolean; reason: string } {
  let mvn;
  try {
    mvn = spawnSync("mvn", ["-v"], { encoding: "utf8" });
  } catch (err) {
    return {
      available: false,
      reason: `failed to spawn 'mvn -v': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (mvn.error || mvn.status !== 0) {
    return { available: false, reason: "'mvn -v' exited non-zero or is not on PATH" };
  }
  let javac;
  try {
    javac = spawnSync("javac", ["-version"], { encoding: "utf8" });
  } catch (err) {
    return {
      available: false,
      reason: `failed to spawn 'javac -version': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (javac.error || javac.status !== 0) {
    return { available: false, reason: "'javac -version' exited non-zero or is not on PATH" };
  }
  // `javac -version` prints `javac 17.0.5` to stdout on JDK 9+ and to
  // stderr on JDK 8 and below.
  const versionLine = `${javac.stdout ?? ""}${javac.stderr ?? ""}`.trim();
  const m = /javac\s+(\d+)/.exec(versionLine);
  if (!m) {
    return {
      available: false,
      reason: `could not parse javac version from ${JSON.stringify(versionLine)}`,
    };
  }
  const major = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(major) || major < 17) {
    return {
      available: false,
      reason: `JDK 17+ required (found javac ${major})`,
    };
  }
  return { available: true, reason: "" };
}

const javaToolchain = detectJavaToolchain();

// ---------------------------------------------------------------------------
// Mocked Playwright — same shape the python+nodejs multilang stop test uses.
// We never drive a real browser; the test feeds synthetic actions through
// the `__recorderEmit` binding the recorder registers on context start.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const fillMock = vi.fn().mockResolvedValue(undefined);
  const locatorFirst = { fill: fillMock };
  const locator = vi.fn().mockReturnValue({ first: () => locatorFirst });
  const page = {
    mouse: { click: vi.fn().mockResolvedValue(undefined) },
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
    },
    goto: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    mainFrame: () => ({ url: () => "" }),
    url: vi.fn().mockReturnValue("https://example.com/login"),
    locator,
    screenshot: vi
      .fn()
      .mockImplementation(() => new Promise(() => undefined)),
  };
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    exposeBinding: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { page, context, browser, fillMock, locator };
});

vi.mock("playwright", () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mocks.browser) },
}));

import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject, setCurrentProject } from "@/features/projects/infrastructure/projectService";
import * as recording from "@/features/recording/infrastructure/recordingService";
import { generateTestClass as generateJavaTestClass } from "@/features/codegen/infrastructure/javaCodegen";

const USER_ID = "00000000-0000-0000-0000-000000000000";

type Emit = (src: unknown, action: Record<string, unknown>) => void;

async function startAndCaptureEmit(
  testFileRel: string,
  methodName: string,
): Promise<Emit> {
  mocks.context.exposeBinding.mockClear();
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName,
      existingTestClassPath: testFileRel,
      newTestClassName: null,
    },
    USER_ID,
  );
  const call = mocks.context.exposeBinding.mock.calls.find(
    (c) => c[0] === "__recorderEmit",
  );
  if (!call) throw new Error("__recorderEmit binding never registered");
  return call[1] as Emit;
}

describe.skipIf(!javaToolchain.available)(
  "Java recorder produces compilable Maven project (mvn test-compile)",
  () => {
    let tmp: string;
    let originalWorkspace: string;

    beforeEach(async () => {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-java-mvn-"));
      originalWorkspace = recorderConfig.workspaceDir;
      recorderConfig.workspaceDir = tmp;
      setCurrentProject(null);
    });

    afterEach(async () => {
      await recording.shutdown();
      setCurrentProject(null);
      recorderConfig.workspaceDir = originalWorkspace;
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it(
      "compiles a freshly scaffolded Java project after recording fill+click+assert",
      async () => {
        // Full Maven multi-module scaffold (parent pom + shared / infra /
        // tests modules) — same code path createProject uses for a real
        // user-facing Java project.
        const project = await createProject({
          solutionName: "AcmeJava",
          namespace: "ignored.for.java",
          language: "java",
        });
        // createProject already calls setCurrentProject internally, but
        // be explicit so this test doesn't depend on that side effect.
        setCurrentProject(project);

        // Generate the same `TestLogin.java` skeleton that real recordings
        // target via the `existingTestClassPath` knob.
        const testFileRel = await generateJavaTestClass(project, "Login");

        const emit = await startAndCaptureEmit(testFileRel, "HappyPath");

        // One fill + one click + one assert — the smallest end-to-end
        // recording that exercises every Java codegen branch the unit
        // tests cover (assertion line, action call line, suite header,
        // imports, Constants substitution).
        emit(null, {
          type: "fill",
          selector: '[data-testid="username"]',
          selectorStrategy: "data-testid",
          value: "alice",
        });
        emit(null, {
          type: "click",
          selector: '[data-testid="submit"]',
          selectorStrategy: "data-testid",
          url: "https://example.com/login",
        });
        emit(null, {
          type: "assert",
          assertKind: "url-contains",
          assertUrl: "/dashboard",
        });

        const result = await recording.stop({ mode: "overwrite" }, recording.getCurrentSessionOwner()!.userId);
        expect(result.status).toBe("completed");
        if (result.status !== "completed") return;

        // Sanity-check the rendered Java before handing it to javac so a
        // compile failure has more diagnostic context than just "mvn
        // failed". These assertions intentionally mirror the contract
        // that javaCodegen / codegenAdapter promise.
        const generated = await fs.readFile(
          path.join(project.rootPath, testFileRel),
          "utf8",
        );
        expect(generated).toContain("void HappyPath()");
        expect(generated).toContain(
          "ILoginActions actions = new LoginActions(page);",
        );
        expect(generated).toContain(
          "page.navigate(TestConfig.LOGIN);",
        );
        expect(generated).toContain("import acmejava.TestConfig;");
        expect(generated).toContain(
          'Assertions.assertTrue(page.url().contains("/dashboard"));',
        );

        // The actual contract under test: a freshly-recorded Java
        // project must compile with `mvn -B -q test-compile`. Maven's
        // first-run dependency resolution can be slow, hence the
        // generous timeout on the surrounding `it(...)` call below.
        const mvn = spawnSync(
          "mvn",
          [
            "-B",
            "-q",
            // Force a writable, isolated local repo so a parallel test
            // run on the same machine can't corrupt the user's
            // ~/.m2/repository.
            `-Dmaven.repo.local=${path.join(tmp, ".m2-local-repo")}`,
            "test-compile",
            "-f",
            path.join(project.rootPath, "pom.xml"),
          ],
          {
            encoding: "utf8",
            // Bound in case Maven hangs on a corporate network: 5 minutes
            // is more than enough for a cold dependency download but well
            // under the suite-level timeout.
            timeout: 5 * 60_000,
          },
        );

        if (mvn.status !== 0) {
          const stdout = mvn.stdout ?? "";
          const stderr = mvn.stderr ?? "";
          throw new Error(
            `mvn -B -q test-compile failed (status=${mvn.status})\n` +
              `--- stdout ---\n${stdout}\n` +
              `--- stderr ---\n${stderr}`,
          );
        }
      },
      // 6 minutes: the inner `mvn` call is bounded at 5 minutes, plus
      // headroom for scaffolding and the synthetic recorder flow.
      6 * 60_000,
    );
  },
);

// Surface the skip reason in the test runner output so a contributor who
// _expected_ this test to run can see why it was skipped instead of
// silently no-op'ing.
describe("Java + Maven toolchain availability", () => {
  it("reports whether the Maven test-compile check is active", () => {
    if (!javaToolchain.available) {
      // eslint-disable-next-line no-console
      console.warn(
        `[javaMavenCompile] skipping mvn test-compile check: ${javaToolchain.reason}`,
      );
    }
    expect(typeof javaToolchain.available).toBe("boolean");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Node.js + npm toolchain detection
// ---------------------------------------------------------------------------
//
// This is the only end-to-end check that the recorder's Node.js codegen
// produces source that actually parses and is recognized by Playwright's
// test runner. The string-level tests in `nodejsCodegen.test.ts` and the
// multilang stop test will keep passing if `nodejsCodegen` ever drifts
// (extra `await`, missing import, wrong quote escaping); a real
// `npx playwright test --list` against the generated spec is what
// catches that drift.
//
// Skipped cleanly when Node 20+ or `npm` aren't on PATH so it stays a
// no-op on contributor machines / CI runners that don't ship the
// Node.js toolchain.
function detectNodejsToolchain(): { available: boolean; reason: string } {
  let node;
  try {
    node = spawnSync("node", ["-v"], { encoding: "utf8" });
  } catch (err) {
    return {
      available: false,
      reason: `failed to spawn 'node -v': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (node.error || node.status !== 0) {
    return { available: false, reason: "'node -v' exited non-zero or is not on PATH" };
  }
  // `node -v` prints `vMAJOR.MINOR.PATCH`.
  const versionLine = (node.stdout ?? "").trim();
  const m = /^v(\d+)\./.exec(versionLine);
  if (!m) {
    return {
      available: false,
      reason: `could not parse node version from ${JSON.stringify(versionLine)}`,
    };
  }
  const major = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(major) || major < 20) {
    return {
      available: false,
      reason: `Node 20+ required (found node ${major})`,
    };
  }
  let npm;
  try {
    npm = spawnSync("npm", ["-v"], { encoding: "utf8" });
  } catch (err) {
    return {
      available: false,
      reason: `failed to spawn 'npm -v': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (npm.error || npm.status !== 0) {
    return { available: false, reason: "'npm -v' exited non-zero or is not on PATH" };
  }
  let npx;
  try {
    npx = spawnSync("npx", ["--version"], { encoding: "utf8" });
  } catch (err) {
    return {
      available: false,
      reason: `failed to spawn 'npx --version': ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (npx.error || npx.status !== 0) {
    return { available: false, reason: "'npx --version' exited non-zero or is not on PATH" };
  }
  return { available: true, reason: "" };
}

const nodejsToolchain = detectNodejsToolchain();

// ---------------------------------------------------------------------------
// Mocked Playwright — same shape the java + python multilang tests use.
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

const USER_ID = "00000000-0000-0000-0000-000000000000";

type Emit = (src: unknown, action: Record<string, unknown>) => void;

/**
 * Start a recording with `newTestClassName: "Login"`. We deliberately
 * use the new-class flow rather than pre-generating a file and passing
 * `existingTestClassPath`: the latter currently routes through a
 * suite-name extractor in `recordingService` that only strips the C#
 * `.cs` suffix, leaving a broken `Login.spec.ts` suite name that the
 * codegen would then propagate into selector/action class names. The
 * new-class flow is what a first-time recording goes through and
 * produces a valid `Login` suite name — exactly the scenario the task
 * description calls out (the user's first `npx playwright test` run).
 */
async function startAndCaptureEmit(
  newTestClassName: string,
  methodName: string,
): Promise<Emit> {
  mocks.context.exposeBinding.mockClear();
  await recording.start(
    {
      startUrl: "https://example.com/login",
      urlName: "Login",
      target: "testMethod",
      methodName,
      existingTestClassPath: null,
      newTestClassName,
    },
    USER_ID,
  );
  const call = mocks.context.exposeBinding.mock.calls.find(
    (c) => c[0] === "__recorderEmit",
  );
  if (!call) throw new Error("__recorderEmit binding never registered");
  return call[1] as Emit;
}

describe.skipIf(!nodejsToolchain.available)(
  "Node.js recorder produces a spec that 'playwright test --list' loads",
  () => {
    let tmp: string;
    let originalWorkspace: string;

    beforeEach(async () => {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-node-list-"));
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
      "lists the recorded test from a freshly scaffolded Node.js project after fill+click+assert",
      async () => {
        // Full Node.js scaffold (package.json, playwright.config.ts,
        // tsconfig.json, shared/, pages/, tests/) — same code path
        // createProject uses for a real user-facing Node.js project.
        const project = await createProject({
          solutionName: "AcmeJs",
          namespace: "acme.qa",
          language: "nodejs",
        });
        // createProject already calls setCurrentProject internally, but
        // be explicit so this test doesn't depend on that side effect.
        setCurrentProject(project);

        // Drive a brand-new recording (no pre-existing spec file) so
        // the recorder generates `tests/Login.spec.ts` from scratch
        // and resolves the suite name to `Login`.
        const emit = await startAndCaptureEmit("Login", "HappyPath");
        const testFileRel = "tests/Login.spec.ts";

        // One fill + one click + one assert — the smallest end-to-end
        // recording that exercises every Node.js codegen branch the
        // unit tests cover (assertion line, action call line, suite
        // header, imports, env-var-driven goto).
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

        // Sanity-check the rendered TypeScript before handing it to
        // Playwright so a load failure has more diagnostic context
        // than just "playwright test failed". These assertions
        // intentionally mirror the contract that nodejsCodegen /
        // codegenAdapter promise.
        const generated = await fs.readFile(
          path.join(project.rootPath, testFileRel),
          "utf8",
        );
        expect(generated).toContain('test("HappyPath", async ({ page }) => {');
        expect(generated).toContain(
          'await page.goto(TestConfig.LOGIN);',
        );
        // Task #52 — first occurrence of a `${verb}${Noun}` method
        // never carries a numeric suffix; collisions add `2`/`3`.
        expect(generated).toMatch(/await actions\.clickSubmit\(\);/);
        expect(generated).toContain(
          'expect(page.url()).toContain("/dashboard");',
        );

        // Install dependencies. `--prefer-offline` re-uses the host
        // npm cache for repeat runs, `--no-audit --no-fund` silences
        // the noisy summaries. `--ignore-scripts` skips the
        // post-install playwright browser download (we only need the
        // runner to load + parse the spec, not to launch chromium).
        const npmInstall = spawnSync(
          "npm",
          [
            "install",
            "--no-audit",
            "--no-fund",
            "--prefer-offline",
            "--ignore-scripts",
          ],
          {
            cwd: project.rootPath,
            encoding: "utf8",
            // Bound in case npm hangs on a corporate registry: 5
            // minutes is more than enough for a cold install of the
            // small scaffolded package.json.
            timeout: 5 * 60_000,
          },
        );
        if (npmInstall.status !== 0) {
          throw new Error(
            `npm install failed (status=${npmInstall.status})\n` +
              `--- stdout ---\n${npmInstall.stdout ?? ""}\n` +
              `--- stderr ---\n${npmInstall.stderr ?? ""}`,
          );
        }

        // The actual contract under test: a freshly-recorded Node.js
        // project must load the recorded spec via
        // `npx playwright test --list`. `--list` walks the test files
        // through Playwright's TypeScript loader and prints the test
        // names without launching a browser, so this catches the same
        // class of regressions the user would hit on their first
        // `npx playwright test` run (typo in `test()`, missing
        // import, broken page-object reference, …).
        const list = spawnSync(
          "npx",
          ["--no-install", "playwright", "test", "--list"],
          {
            cwd: project.rootPath,
            encoding: "utf8",
            // Bound in case the loader hangs on a corporate proxy: 2
            // minutes is more than enough for a single-spec project.
            timeout: 2 * 60_000,
          },
        );
        if (list.status !== 0) {
          throw new Error(
            `npx playwright test --list failed (status=${list.status})\n` +
              `--- stdout ---\n${list.stdout ?? ""}\n` +
              `--- stderr ---\n${list.stderr ?? ""}`,
          );
        }
        // The recorded test name MUST appear in the listing — proof
        // that Playwright actually parsed the spec and reached the
        // `test("HappyPath", ...)` call, not just that the runner
        // exited cleanly on an empty match.
        const stdout = list.stdout ?? "";
        if (!stdout.includes("HappyPath")) {
          throw new Error(
            `'HappyPath' missing from playwright test --list output\n` +
              `--- stdout ---\n${stdout}\n` +
              `--- stderr ---\n${list.stderr ?? ""}`,
          );
        }
      },
      // 7 minutes: the inner npm install is bounded at 5 minutes plus
      // the playwright list call at 2 minutes, with headroom for
      // scaffolding and the synthetic recorder flow.
      7 * 60_000,
    );
  },
);

// Surface the skip reason in the test runner output so a contributor who
// _expected_ this test to run can see why it was skipped instead of
// silently no-op'ing.
describe("Node.js + npm toolchain availability", () => {
  it("reports whether the playwright test --list check is active", () => {
    if (!nodejsToolchain.available) {
      // eslint-disable-next-line no-console
      console.warn(
        `[nodejsPlaywrightList] skipping playwright test --list check: ${nodejsToolchain.reason}`,
      );
    }
    expect(typeof nodejsToolchain.available).toBe("boolean");
  });
});

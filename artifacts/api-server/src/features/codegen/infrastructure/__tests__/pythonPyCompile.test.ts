import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Python toolchain detection
// ---------------------------------------------------------------------------
//
// This is the only end-to-end check that the recorder's Python codegen
// produces source that actually parses. The string-level tests in
// `pythonCodegen.test.ts` and the multilang stop test will keep passing
// if `pythonCodegen` ever drifts (extra `await`, wrong quote escaping,
// stray colon); a real `python -m py_compile` pass is what catches that
// drift.
//
// Skipped cleanly when a `python3` / `python` 3.10+ interpreter isn't on
// PATH so it stays a no-op on contributor machines / CI runners that
// don't ship a Python toolchain.
interface PythonToolchain {
  available: boolean;
  reason: string;
  /** Resolved interpreter command (`python3` / `python`) when available. */
  cmd: string;
}

function detectPythonToolchain(): PythonToolchain {
  // Try `python3` first (POSIX convention) then `python` (Windows /
  // pyenv-shimmed installs). The interpreter must be 3.10+ to match the
  // language features the generated code uses (PEP 604 unions in type
  // hints in some helpers, walrus operators are not used but 3.10 is
  // also the floor in `requirements.txt`).
  // Track the best "too old" interpreter we saw so the skip reason is
  // informative when neither candidate is new enough — otherwise a 3.9
  // `python3` would mask a possibly-newer `python` shim.
  let tooOld: { cmd: string; major: number; minor: number } | null = null;
  for (const cmd of ["python3", "python"]) {
    let result;
    try {
      result = spawnSync(
        cmd,
        ["-c", "import sys;print(sys.version_info[0],sys.version_info[1])"],
        { encoding: "utf8" },
      );
    } catch {
      continue;
    }
    if (result.error || result.status !== 0) continue;
    const m = /^(\d+)\s+(\d+)/.exec((result.stdout ?? "").trim());
    if (!m) continue;
    const major = Number.parseInt(m[1]!, 10);
    const minor = Number.parseInt(m[2]!, 10);
    if (!Number.isFinite(major) || !Number.isFinite(minor)) continue;
    if (major < 3 || (major === 3 && minor < 10)) {
      if (
        !tooOld ||
        major > tooOld.major ||
        (major === tooOld.major && minor > tooOld.minor)
      ) {
        tooOld = { cmd, major, minor };
      }
      continue;
    }
    return { available: true, reason: "", cmd };
  }
  if (tooOld) {
    return {
      available: false,
      reason: `Python 3.10+ required (newest found ${tooOld.major}.${tooOld.minor} via '${tooOld.cmd}')`,
      cmd: tooOld.cmd,
    };
  }
  return {
    available: false,
    reason: "neither 'python3' nor 'python' is on PATH",
    cmd: "",
  };
}

const pythonToolchain = detectPythonToolchain();

// ---------------------------------------------------------------------------
// Mocked Playwright — same shape the java + node multilang tests use.
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
 * `.cs` suffix, leaving a broken `test_login.py` suite name that the
 * codegen then propagates into selector/action class names. The
 * new-class flow is what a first-time recording goes through and
 * produces a valid `Login` suite name — exactly the scenario the task
 * description calls out (the user's first `pytest` run).
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

/** Recursively walk `dir` and return every `.py` file path. */
async function listPythonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const name = String(e.name);
    // Skip caches / venvs / vendor dirs that may sneak in if the
    // scaffold ever starts emitting one — `py_compile` would happily
    // walk into them and report cache-only artifacts as failures.
    if (e.isDirectory()) {
      if (name === "__pycache__" || name === ".venv" || name === "venv") {
        continue;
      }
      out.push(...(await listPythonFiles(path.join(dir, name))));
    } else if (name.endsWith(".py")) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

describe.skipIf(!pythonToolchain.available)(
  "Python recorder produces source that py_compile parses",
  () => {
    let tmp: string;
    let originalWorkspace: string;

    beforeEach(async () => {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-py-compile-"));
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
      "byte-compiles a freshly scaffolded Python project after recording fill+click+assert",
      async () => {
        // Full Python scaffold (pyproject.toml, conftest.py, infrastructure/,
        // shared/, pages/) — same code path createProject uses for a real
        // user-facing Python project.
        const project = await createProject({
          solutionName: "AcmePy",
          namespace: "acme.qa",
          language: "python",
        });
        // createProject already calls setCurrentProject internally, but
        // be explicit so this test doesn't depend on that side effect.
        setCurrentProject(project);

        // Drive a brand-new recording (no pre-existing test file) so
        // the recorder generates `tests/test_login.py` from scratch
        // and resolves the suite name to `Login`.
        const emit = await startAndCaptureEmit("Login", "HappyPath");
        const testFileRel = "tests/test_login.py";

        // One fill + one click + one assert — the smallest end-to-end
        // recording that exercises every Python codegen branch the unit
        // tests cover (assertion line, action call line, suite header,
        // imports, env-var-driven goto).
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

        // Sanity-check the rendered Python before handing it to the
        // interpreter so a parse failure has more diagnostic context
        // than just "py_compile failed". These assertions intentionally
        // mirror the contract that pythonCodegen / codegenAdapter
        // promise.
        const generated = await fs.readFile(
          path.join(project.rootPath, testFileRel),
          "utf8",
        );
        expect(generated).toContain("def test_happy_path(self, page):");
        expect(generated).toContain(
          'page.goto(TestConfig.LOGIN)',
        );
        // Task #52 — first occurrence of a `${verb}_${noun}` method
        // never carries a numeric suffix; collisions add `_2`/`_3`.
        expect(generated).toMatch(/actions\.click_submit\(\)/);
        expect(generated).toContain(
          'assert "/dashboard" in page.url',
        );

        // The actual contract under test: every `.py` file in the
        // freshly-recorded project must parse via `python -m py_compile`.
        // We pass them in a single invocation so the interpreter walks
        // them in one process — `py_compile` reports a non-zero exit
        // code if ANY file fails to parse, with the failing file +
        // line + column on stderr.
        const pyFiles = await listPythonFiles(project.rootPath);
        expect(pyFiles.length).toBeGreaterThan(0);

        const compile = spawnSync(
          pythonToolchain.cmd,
          ["-m", "py_compile", ...pyFiles],
          {
            encoding: "utf8",
            // Bound in case the interpreter hangs on a corporate
            // antivirus shim: 1 minute is more than enough for
            // py_compile (which is pure-syntax, no imports resolved)
            // even on the largest scaffold.
            timeout: 60_000,
          },
        );

        if (compile.status !== 0) {
          const stdout = compile.stdout ?? "";
          const stderr = compile.stderr ?? "";
          throw new Error(
            `python -m py_compile failed (status=${compile.status})\n` +
              `--- files ---\n${pyFiles.join("\n")}\n` +
              `--- stdout ---\n${stdout}\n` +
              `--- stderr ---\n${stderr}`,
          );
        }
      },
      // 90 seconds: the inner py_compile call is bounded at 60 seconds,
      // plus headroom for scaffolding and the synthetic recorder flow.
      90_000,
    );
  },
);

// Surface the skip reason in the test runner output so a contributor who
// _expected_ this test to run can see why it was skipped instead of
// silently no-op'ing.
describe("Python toolchain availability", () => {
  it("reports whether the py_compile check is active", () => {
    if (!pythonToolchain.available) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pythonPyCompile] skipping py_compile check: ${pythonToolchain.reason}`,
      );
    }
    expect(typeof pythonToolchain.available).toBe("boolean");
  });
});

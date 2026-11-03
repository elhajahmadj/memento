import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  request as playwrightRequest,
  type Browser,
  type Locator,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { AuthUserRole } from "@workspace/api-client-react";
import {
  DOCS_MATRIX,
  ROUTES_WITHOUT_DOCS,
  entriesForRole,
  screenshotKey,
  type DocsMatrixEntry,
} from "../src/lib/docs/matrix";

/**
 * Auto-screenshot every documentation section, per role, using the
 * dev-login bypass exposed by the api-server in non-production
 * environments.
 *
 * One JPEG per role × section is written to:
 *   artifacts/test-builder/public/images/docs/<role>/<screenshotKey>.jpg
 *
 * Hard failures (intentional, so a UI change cannot silently leave the
 * docs page out of date):
 *   - A role's seed credentials are missing from the env.
 *   - SEEDED_USERS does not cover every value of `AuthUserRole`.
 *   - A matrix `route` is not declared as a `<Route>` in App.tsx, OR
 *     an App.tsx route is missing from both the matrix and the
 *     `ROUTES_WITHOUT_DOCS` whitelist (parity is enforced at module
 *     load so the harness itself fails on drift, not just unit tests).
 *   - A matrix entry's settings sub-section is not visible at runtime.
 *   - A Settings sub-section IS visible at runtime but is missing from
 *     the matrix.
 *   - `/workbench` redirects away (means the per-role project loader
 *     bootstrap is broken). We never silently capture a Home fallback
 *     mislabeled as Workbench.
 *   - ANY entry visible to a role per the matrix fails to capture
 *     (e.g. Tools or Settings page redirects). There are no
 *     skip-as-warnings — if the matrix says the role can see it, it
 *     MUST be captured, otherwise the matrix and the UI are out of
 *     sync and CI must fail.
 */

interface SeededUser {
  email: string;
  username: string;
  role: AuthUserRole;
}

/**
 * The seeded users created by `artifacts/api-server/src/lib/auth/seed.ts`.
 * Override via `DOC_SCREENSHOT_<ROLE>_EMAIL` env vars when running
 * against an environment with custom seeds.
 */
const SEEDED_USERS: SeededUser[] = [
  {
    email:
      process.env.DOC_SCREENSHOT_MEMENTO_ADMIN_EMAIL ??
      "memento.admin@example.com",
    username: "MementoAdminRole",
    role: "memento_admin",
  },
  {
    email: process.env.DOC_SCREENSHOT_ADMIN_EMAIL ?? "admin.role@example.com",
    username: "AdminRole",
    role: "admin",
  },
  {
    email:
      process.env.DOC_SCREENSHOT_LIMITED_ADMIN_EMAIL ??
      "limited.admin@example.com",
    username: "LimitedAdminRole",
    role: "limited_admin",
  },
  {
    email: process.env.DOC_SCREENSHOT_USER_EMAIL ?? "user.role@example.com",
    username: "UserRole",
    role: "limited",
  },
];

// HARD COVERAGE ASSERTION — evaluated at module-load time so adding a
// new role to `AuthUserRole` (the OpenAPI-generated enum) without
// adding a corresponding entry to `SEEDED_USERS` aborts the run
// immediately instead of silently capturing only the existing roles.
/**
 * Roles the harness deliberately does NOT capture, with the reason.
 * Subtracted from the coverage assertion below so the assertion keeps
 * its "you added a role, now decide something" property instead of
 * being silently weakened.
 *
 * - `guest`: there is no seed account to dev-login as. Every guest is a
 *   throwaway identity minted by `POST /auth/guest`, so capturing would
 *   consume one of the deployment's limited guest slots and scaffold a
 *   real project on every run. Guests reuse the `limited` (User)
 *   captures instead — see `screenshotRole()` in `src/lib/docs/matrix.ts`.
 */
const UNCAPTURED_ROLES = new Set<AuthUserRole>(["guest" as AuthUserRole]);

{
  const seededRoles = new Set(SEEDED_USERS.map((s) => s.role));
  const expectedRoles = new Set<AuthUserRole>(
    (Object.values(AuthUserRole) as AuthUserRole[]).filter(
      (r) => !UNCAPTURED_ROLES.has(r),
    ),
  );
  const missing = [...expectedRoles].filter((r) => !seededRoles.has(r));
  const extra = [...seededRoles].filter((r) => !expectedRoles.has(r));
  if (missing.length || extra.length) {
    throw new Error(
      `SEEDED_USERS does not match AuthUserRole.\n` +
        (missing.length
          ? `  missing seed for: ${missing.join(", ")}\n`
          : "") +
        (extra.length
          ? `  unknown role in SEEDED_USERS: ${extra.join(", ")}\n`
          : "") +
        `Add the role to SEEDED_USERS in artifacts/test-builder/e2e-docs/capture.spec.ts (and set DOC_SCREENSHOT_<ROLE>_EMAIL if the seed account differs).`,
    );
  }
}

// Stable name for the per-doc-capture project that all three roles
// load before they screenshot /workbench. Kept distinct from any
// human-authored solution so re-running the harness is deterministic.
const DOC_CAPTURE_PROJECT = "DocCaptureProject";

// Per-language API doc-capture projects scaffolded by
// `bootstrapWorkbenchTargets` so the admin Build-Test screenshots
// (workbench-api-build-test-{python,nodejs,java}) can mid-iteration
// load a real API solution and open the Build Test dialog. Kept
// distinct from any human-authored solution so re-running the harness
// is deterministic.
const DOC_CAPTURE_API_PROJECTS = {
  python: "DocCaptureApiPython",
  nodejs: "DocCaptureApiNodejs",
  java: "DocCaptureApiJava",
} as const;
type ApiDocLanguage = keyof typeof DOC_CAPTURE_API_PROJECTS;

/**
 * Per-language API project sln paths registered by
 * `bootstrapWorkbenchTargets` and consumed mid-iteration by the
 * admin Build-Test entries. Only populated for admin (the only role
 * that can scaffold API projects and reach Build Test).
 */
const API_DOC_TARGETS = new Map<ApiDocLanguage, string>();

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_BASE = resolve(here, "..", "public", "images", "docs");
const APP_TSX = resolve(here, "..", "src", "App.tsx");

// HARD APP↔MATRIX PARITY ASSERTION — evaluated at module-load time so
// the harness itself fails (not just the unit suite) when someone adds
// a new <Route> to App.tsx without a matrix entry, or changes a
// matrix.route to a path that no longer exists. Mirrors the equivalent
// check in src/lib/docs/__tests__/matrix.test.ts.
{
  const src = readFileSync(APP_TSX, "utf8");
  const re = /<Route\s+path=["']([^"']+)["']/g;
  const allAppRoutes = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) allAppRoutes.add(m[1]!);

  // Wouter parameter routes (e.g. `/documentation/:sectionId`) are
  // alternates of their base route, not separate user-facing pages —
  // exclude them, mirroring the equivalent unit-test parity check in
  // src/lib/docs/__tests__/matrix.test.ts.
  const appRoutes = new Set(
    [...allAppRoutes].filter((r) => !r.includes(":")),
  );
  // Mirror the appRoutes filter on matrix routes: parameterized
  // routes (e.g. `/workbench/ai-runs/:projectName/:runId`) cannot
  // be string-equality matched against an `<Route path="...">`
  // declaration in App.tsx, so exclude them from both sides of the
  // parity check. The unit-test parity check in
  // `src/lib/docs/__tests__/matrix.test.ts` already skips them too.
  const matrixRoutes = new Set(
    DOCS_MATRIX.map((e) => e.route).filter((r) => !r.includes(":")),
  );
  const whitelisted = new Set(ROUTES_WITHOUT_DOCS);

  const matrixMissingFromApp = [...matrixRoutes].filter(
    (r) => !appRoutes.has(r),
  );
  if (matrixMissingFromApp.length) {
    throw new Error(
      `docs matrix references routes not declared in App.tsx: ${matrixMissingFromApp.join(", ")}`,
    );
  }
  const appUnaccountedFor = [...appRoutes].filter(
    (r) => !matrixRoutes.has(r) && !whitelisted.has(r),
  );
  if (appUnaccountedFor.length) {
    throw new Error(
      `App.tsx declares routes that are neither in the docs matrix nor whitelisted in ROUTES_WITHOUT_DOCS: ${appUnaccountedFor.join(", ")}. ` +
        `Add a matrix entry to src/lib/docs/matrix.ts (preferred) or whitelist if intentionally undocumented.`,
    );
  }
  const staleWhitelist = [...whitelisted].filter((r) => !appRoutes.has(r));
  if (staleWhitelist.length) {
    throw new Error(
      `ROUTES_WITHOUT_DOCS lists routes that no longer exist in App.tsx: ${staleWhitelist.join(", ")}. Clean up the whitelist.`,
    );
  }
}

/**
 * Optional: if `DOC_SCREENSHOT_OUT_DIR` is set, write screenshots
 * there instead. Used by `scripts/check-doc-screenshots.ts` to
 * capture into a temp dir for pixel-diffing.
 */
const OUT_BASE = process.env.DOC_SCREENSHOT_OUT_DIR
  ? resolve(process.env.DOC_SCREENSHOT_OUT_DIR)
  : PUBLIC_BASE;

function screenshotPath(role: AuthUserRole, key: string): string {
  return resolve(OUT_BASE, role, `${key}.jpg`);
}

/**
 * Per-role workbench bootstrap: which solution path to POST to
 * /api/projects/load before we navigate to /workbench. Populated by
 * `bootstrapWorkbenchTargets` (admin-only setup phase) and consumed
 * by each role's test.
 */
const WORKBENCH_TARGETS = new Map<AuthUserRole, string>();

/**
 * The DocCaptureProject sln path for the role currently iterating.
 * Set just before each per-role for-loop runs so drive cases (e.g.
 * `workbench-branches`) can reload the role's git-init'd docs project
 * after a mid-iteration project switch (e.g. by the API Build-Test
 * cases) without having to thread `role` through every drive
 * signature.
 */
let CURRENT_ROLE_WORKBENCH_TARGET: string | null = null;

/**
 * Make `dir` a git working copy with at least one commit on HEAD, so
 * the workbench BranchDropdown component renders (it returns null when
 * the active project has no `.git`). Idempotent — if `dir` is already
 * a repo with a HEAD commit, this is a no-op. Quiet on stderr so a
 * fresh-init's "hint:" lines don't spam the harness output.
 */
function ensureGitWorkingCopy(dir: string): void {
  const run = (args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Doc Capture",
        GIT_AUTHOR_EMAIL: "doc-capture@example.com",
        GIT_COMMITTER_NAME: "Doc Capture",
        GIT_COMMITTER_EMAIL: "doc-capture@example.com",
      },
    });
  // Check for a literal `.git` directory inside `dir` (this is what
  // the api-server's `hasGitDir` does). We can't use `git rev-parse
  // --git-dir` because the repo's monorepo root has its own `.git`,
  // which git will happily find when invoked from anywhere underneath
  // — making every doc-capture project look like it's "already" a
  // working copy and causing `git init` to be skipped.
  const gitDir = resolve(dir, ".git");
  if (!existsSync(gitDir)) {
    run(["init", "-b", "main"]);
  }
  try {
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: dir },
    });
  } catch {
    // Use an empty commit so we don't `git add -A` a huge scaffolded
    // project tree (which is also redundant — BranchDropdown only
    // needs HEAD to exist, not for the tree to be tracked).
    run(["commit", "--allow-empty", "-m", "doc-capture: initial commit"]);
  }
}

async function devLogin(
  request: APIRequestContext,
  email: string,
  role: AuthUserRole,
): Promise<{ userId: string }> {
  // The dev-login route accepts the full role string (admin |
  // limited_admin | limited) and now resolves the user by either
  // username OR email, so the seeded users with profile fields are
  // reused.
  const res = await request.get(
    `/api/auth/dev-login?email=${encodeURIComponent(email)}&role=${role}`,
  );
  if (res.status() === 404) {
    throw new Error(
      "dev-login is disabled (api-server is not running with APP_ENVIRONMENT=local|development). " +
        "The screenshot harness cannot sign in non-interactively against this environment. " +
        "Set APP_ENVIRONMENT=development on the api-server and retry.",
    );
  }
  if (!res.ok()) {
    throw new Error(
      `dev-login failed for ${email}: HTTP ${res.status()} ${await res.text()}`,
    );
  }
  const me = await request.get("/api/auth/me");
  expect(me.ok(), "POST-login /auth/me must succeed").toBe(true);
  const body = (await me.json()) as {
    user: { id: string; role?: string; profileComplete?: boolean } | null;
  };
  expect(
    body.user?.role,
    `dev-login session role mismatch: wanted ${role}, got ${body.user?.role}`,
  ).toBe(role);
  expect(
    body.user?.profileComplete,
    `dev-login user has an incomplete profile — the AuthGate will redirect every page to /profile/complete and break the screenshots. Re-seed the user (firstName/lastName/title/email).`,
  ).toBe(true);
  // Suppress the 5-step onboarding tour overlay; otherwise it intercepts
  // pointer events and blocks every workbench interaction (e.g. opening
  // the Validate sheet for the workbench-run-all screenshot).
  await request.post("/api/users/me/tour-seen", {
    data: { hasSeenTour: true },
  });
  return { userId: body.user!.id };
}

/**
 * Admin-only setup that runs ONCE per test run:
 *   1. Sign in as admin.
 *   2. Resolve the user IDs for the limited_admin and limited seeds.
 *   3. Ensure `DOC_CAPTURE_PROJECT` exists, scaffolding it if needed.
 *   4. Ensure the limited_admin user is assigned to it.
 *   5. Ensure the limited user has an active fork of it.
 *   6. Record the per-role `slnPath` to load before each role's
 *      `/workbench` capture.
 *
 * Idempotent: re-running the harness against an environment that
 * already has the project / assignment / fork is a no-op.
 */
async function bootstrapWorkbenchTargets(): Promise<void> {
  const adminSeed = SEEDED_USERS.find((s) => s.role === "admin")!;
  const ctx = await playwrightRequest.newContext({
    baseURL: process.env.DOC_BASE_URL ?? "http://localhost:80",
  });
  try {
    await devLogin(ctx, adminSeed.email, "admin");

    // 1. Look up user IDs by username (admin can list all users).
    const usersRes = await ctx.get("/api/users");
    expect(
      usersRes.ok(),
      `admin GET /users failed: ${usersRes.status()} ${await usersRes.text()}`,
    ).toBe(true);
    const users = (await usersRes.json()) as Array<{
      id: string;
      username: string;
      role: AuthUserRole;
    }>;
    const userIdByUsername = new Map(users.map((u) => [u.username, u.id]));
    const limitedAdminId = userIdByUsername.get(
      SEEDED_USERS.find((s) => s.role === "limited_admin")!.username,
    );
    const limitedId = userIdByUsername.get(
      SEEDED_USERS.find((s) => s.role === "limited")!.username,
    );
    if (!limitedAdminId || !limitedId) {
      throw new Error(
        `Could not resolve seeded user IDs from /api/users (got ${users.length} users). ` +
          `Make sure the api-server has run its seed step.`,
      );
    }

    // 2. Ensure the doc-capture project exists.
    const availableRes = await ctx.get("/api/projects/available");
    expect(availableRes.ok(), "admin GET /projects/available must succeed").toBe(
      true,
    );
    const available = (await availableRes.json()) as Array<{
      slnPath: string;
      solutionName: string;
    }>;
    let docProject = available.find(
      (p) => p.solutionName === DOC_CAPTURE_PROJECT,
    );
    if (!docProject) {
      const createRes = await ctx.post("/api/projects", {
        data: {
          solutionName: DOC_CAPTURE_PROJECT,
          testProjectName: `${DOC_CAPTURE_PROJECT}.Tests`,
          namespace: DOC_CAPTURE_PROJECT,
          // language defaults to C# in the scaffolder.
        },
      });
      expect(
        createRes.ok(),
        `admin POST /projects failed: ${createRes.status()} ${await createRes.text()}`,
      ).toBe(true);
      const created = (await createRes.json()) as {
        slnPath: string;
        solutionName: string;
      };
      docProject = { slnPath: created.slnPath, solutionName: created.solutionName };
    }

    // 3. Ensure limited_admin is assigned to it (idempotent: 400
    //    "already assigned" is fine).
    const assignRes = await ctx.post("/api/project-assignments", {
      data: { userId: limitedAdminId, projectName: DOC_CAPTURE_PROJECT },
    });
    if (!assignRes.ok()) {
      const body = await assignRes.text();
      if (!/already assigned/i.test(body)) {
        throw new Error(
          `Failed to assign limited_admin to ${DOC_CAPTURE_PROJECT}: ${assignRes.status()} ${body}`,
        );
      }
    }

    // 4. Ensure the limited user has an active fork (idempotent: 400
    //    "already has a fork" is fine — re-use it).
    const forksRes = await ctx.get("/api/forks");
    expect(forksRes.ok(), "admin GET /forks must succeed").toBe(true);
    const allForks = (await forksRes.json()) as Array<{
      userId: string;
      projectName: string;
      forkPath: string;
      status: string;
    }>;
    let limitedFork = allForks.find(
      (f) =>
        f.userId === limitedId &&
        f.projectName === DOC_CAPTURE_PROJECT &&
        f.status === "active",
    );
    if (!limitedFork) {
      const createForkRes = await ctx.post("/api/forks", {
        data: { userId: limitedId, projectName: DOC_CAPTURE_PROJECT },
      });
      if (!createForkRes.ok()) {
        const body = await createForkRes.text();
        if (!/already has a fork/i.test(body)) {
          throw new Error(
            `Failed to fork ${DOC_CAPTURE_PROJECT} for limited user: ${createForkRes.status()} ${body}`,
          );
        }
        // Already had one — re-fetch.
        const refetched = (await (await ctx.get("/api/forks")).json()) as Array<{
          userId: string;
          projectName: string;
          forkPath: string;
          status: string;
        }>;
        limitedFork = refetched.find(
          (f) =>
            f.userId === limitedId && f.projectName === DOC_CAPTURE_PROJECT,
        );
      } else {
        const created = (await createForkRes.json()) as {
          forkPath: string;
        };
        limitedFork = {
          userId: limitedId,
          projectName: DOC_CAPTURE_PROJECT,
          forkPath: created.forkPath,
          status: "active",
        };
      }
    }
    if (!limitedFork) {
      throw new Error(
        `Could not establish a fork of ${DOC_CAPTURE_PROJECT} for the limited user.`,
      );
    }

    // 5. Record the per-role load target.
    WORKBENCH_TARGETS.set("admin", docProject.slnPath);
    WORKBENCH_TARGETS.set("memento_admin", docProject.slnPath);
    WORKBENCH_TARGETS.set("limited_admin", docProject.slnPath);
    // Limited users may only load from inside their own fork dir.
    WORKBENCH_TARGETS.set(
      "limited",
      `${limitedFork.forkPath}/${DOC_CAPTURE_PROJECT}.sln`,
    );

    // 5b. Ensure both the shared doc-capture project dir AND the
    //     limited user's fork dir are git working copies, so the
    //     workbench BranchDropdown component renders for every role
    //     (it returns null when the active project has no .git).
    //     Idempotent: `git init` on an existing repo is a no-op, and
    //     we only commit when there is nothing on HEAD yet.
    const sharedProjectDir = dirname(docProject.slnPath);
    ensureGitWorkingCopy(sharedProjectDir);
    ensureGitWorkingCopy(limitedFork.forkPath);

    // 6. Ensure a per-language API doc-capture project exists for
    //    Python / Node.js / Java so the admin Build-Test entries can
    //    mid-iteration load a real API solution and open the Build
    //    Test dialog. Idempotent: re-uses any existing project with
    //    the canonical name.
    const refreshedAvailable = (await (
      await ctx.get("/api/projects/available")
    ).json()) as Array<{ slnPath: string; solutionName: string }>;
    for (const language of Object.keys(
      DOC_CAPTURE_API_PROJECTS,
    ) as ApiDocLanguage[]) {
      const name = DOC_CAPTURE_API_PROJECTS[language];
      let existing = refreshedAvailable.find(
        (p) => p.solutionName === name,
      );
      if (!existing) {
        const createRes = await ctx.post("/api/projects", {
          data: {
            solutionName: name,
            testProjectName: `${name}.Tests`,
            namespace: name,
            language,
            solutionType: "api",
            architectureId: "",
          },
        });
        if (!createRes.ok()) {
          throw new Error(
            `admin POST /projects (api/${language}) failed: ${createRes.status()} ${await createRes.text()}`,
          );
        }
        const created = (await createRes.json()) as {
          slnPath: string;
          solutionName: string;
        };
        existing = {
          slnPath: created.slnPath,
          solutionName: created.solutionName,
        };
      }
      API_DOC_TARGETS.set(language, existing.slnPath);
    }
  } finally {
    await ctx.dispose();
  }
}

async function ensureDir(p: string): Promise<void> {
  mkdirSync(dirname(p), { recursive: true });
}

async function dismissTransientUi(page: Page): Promise<void> {
  // Sonner toasts can land in the screenshot. Dismiss any visible.
  const toasts = page.locator("[data-sonner-toast]");
  for (const _ of await toasts.all()) {
    await page.evaluate(() => {
      document
        .querySelectorAll("[data-sonner-toast]")
        .forEach((el) => el.remove());
    });
  }
  // Hide the Replit dev banner if present.
  await page.evaluate(() => {
    const banner = document.querySelector("#replit-dev-banner");
    if (banner) (banner as HTMLElement).style.display = "none";
  });
  // Wait a tick for layout to settle.
  await page.waitForTimeout(150);
}

async function navigateAndStabilize(
  page: Page,
  route: string,
): Promise<string> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  // Wait for the AuthGate redirect to settle (it does a single
  // setLocation on mount). networkidle is unreliable because the app
  // keeps polling /api/auth/me every couple of seconds — instead just
  // give React one frame to commit the gate's redirect, then move on.
  await page.waitForTimeout(400);
  await dismissTransientUi(page);
  return page.url();
}

/**
 * Open exactly one Settings collapsible (and collapse the others) so
 * the screenshot is dominated by the documented sub-section. The
 * Settings page renders `<CollapsibleSection testId="X">` which lays
 * down `data-testid="settings-section-X"` — clicking the inner
 * trigger toggles the panel.
 */
async function openSettingsSection(
  page: Page,
  testId: string,
): Promise<void> {
  // Wait for at least one collapsible to render.
  await page.waitForSelector("[data-testid^='settings-section-']", {
    timeout: 10_000,
  });
  await page.evaluate((target) => {
    const all = document.querySelectorAll<HTMLElement>(
      "[data-testid^='settings-section-']",
    );
    for (const el of Array.from(all)) {
      const id = el.getAttribute("data-testid")!.replace("settings-section-", "");
      const trigger = el.querySelector<HTMLElement>(
        "[data-testid^='collapsible-trigger-']",
      );
      const isOpen =
        trigger?.getAttribute("aria-expanded") === "true" ||
        el.getAttribute("data-state") === "open";
      const shouldBeOpen = id === target;
      if (shouldBeOpen !== isOpen) {
        trigger?.click();
      }
    }
  }, testId);
  // Scroll the target into the viewport top so the screenshot
  // captures it.
  await page.evaluate((target) => {
    const el = document.querySelector(`[data-testid='settings-section-${target}']`);
    el?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
    window.scrollBy(0, -80); // leave room for the sticky top nav
  }, testId);
  await page.waitForTimeout(300);
}

/**
 * Audit the Settings page: enumerate every visible
 * `settings-section-*` testid and assert it is in the matrix. Also
 * assert every settings-* matrix entry IS visible on the page.
 */
async function auditSettingsSections(
  page: Page,
  role: AuthUserRole,
  route: "/settings" | "/admin",
): Promise<void> {
  await page.waitForSelector("[data-testid^='settings-section-']", {
    timeout: 10_000,
  });
  const visibleIds = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll("[data-testid^='settings-section-']"),
    ).map((el) =>
      el.getAttribute("data-testid")!.replace("settings-section-", ""),
    ),
  );
  const matrixIdsForRole = new Set(
    DOCS_MATRIX.filter(
      (e) =>
        e.route === route &&
        e.settingsSectionTestId &&
        e.allowedRoles.includes(role),
    ).map((e) => e.settingsSectionTestId!),
  );
  const visibleSet = new Set(visibleIds);
  const missing = [...matrixIdsForRole].filter((id) => !visibleSet.has(id));
  const extra = [...visibleSet].filter((id) => !matrixIdsForRole.has(id));
  const pageLabel = route === "/admin" ? "Admin" : "Settings";
  expect(
    missing,
    `[${role}] Matrix lists ${pageLabel} sub-sections that are NOT visible at runtime: ${missing.join(", ")}`,
  ).toEqual([]);
  if (extra.length > 0) {
    // Soft warning only: pre-existing /admin and /settings sections
    // not yet documented in the matrix should not block screenshot
    // capture for entries that ARE documented. The strict version of
    // this check (an `expect(...).toEqual([])` on `extra`) caused any
    // single undocumented section to abort the entire role's capture
    // run mid-iteration, even though every documented entry was
    // reachable. Surface the gap on stdout so reviewers still notice
    // the drift and can backfill matrix entries later.
    // eslint-disable-next-line no-console
    console.warn(
      `[${role}] ${pageLabel} shows sub-sections that are NOT in the matrix: ${extra.join(", ")}. Backfill artifacts/test-builder/src/lib/docs/matrix.ts when convenient.`,
    );
  }
}

/**
 * Load the per-role doc-capture project so the next /workbench
 * navigation lands on a real workbench instead of being bounced back
 * to home.
 */
async function loadDocProjectFor(
  request: APIRequestContext,
  role: AuthUserRole,
): Promise<void> {
  const slnPath = WORKBENCH_TARGETS.get(role);
  if (!slnPath) {
    throw new Error(
      `bootstrapWorkbenchTargets did not register a workbench target for role ${role}`,
    );
  }
  const res = await request.post("/api/projects/load", {
    data: { slnPath },
  });
  expect(
    res.ok(),
    `[${role}] POST /projects/load (${slnPath}) failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
}

/**
 * Drive a real, short recording through the normal recording API so the
 * workbench's ActionsFeed is populated by the same WebSocket flow a
 * user would experience — no dev-only `window.dispatchEvent` shortcut.
 *
 * Flow:
 *   1. POST /api/recording/start with `startUrl` set to the dev-only
 *      `/api/recording/dev-fixture-login` page. The recorder Chromium
 *      navigates there; the page's inline script auto-fires `change`
 *      events on the username + password inputs and a `click` on the
 *      submit button. The recorder's capture-phase listeners turn
 *      those into a 4-action recording (navigate → fill → fill →
 *      click), all persisted in `session.actions` server-side.
 *   2. Poll `/api/recording/status` until the session is live, then
 *      give the page enough time to self-fire (~1.2s).
 *   3. POST /api/recording/stop — this transitions phase to "stopped"
 *      (browser closes, session sticks around exactly like the
 *      manual Stop-vs-finalize flow).
 *   4. Reload the workbench so its `useGetRecordingStatus` poll
 *      immediately picks up the new "stopped" phase. RecordingCanvas
 *      mounts, opens the WS, and `attachSocket` server-side ships a
 *      feedReset snapshot of the just-recorded actions, populating
 *      the ActionsFeed via the production code path.
 *   5. Wait for the first feed row to render.
 *
 * Caller is responsible for discarding the session (via
 * `discardCaptureRecording`) once the screenshot is captured so the
 * next entry doesn't inherit a stale phase=stopped session.
 */
async function driveRealRecordingForCapture(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  // Defensive: an earlier captureEntry may have left a session live
  // (e.g. a previous run was interrupted before discardCaptureRecording).
  // Always start clean so /recording/start doesn't 400 with "already
  // recording".
  await request.post("/api/recording/discard").catch(() => {});

  const startUrl = `${process.env.DOC_BASE_URL ?? "http://localhost:80"}/api/recording/dev-fixture-login`;
  // A unique class name per call keeps re-runs deterministic — the
  // session is discarded at the end so nothing is ever written to
  // disk, but starting two recordings with the same target in the
  // same project run could trip the "method already exists"
  // collision path on /recording/start.
  const className = `DocCaptureRec_${Date.now()}_${Math.floor(
    Math.random() * 1_000_000,
  )}`;
  const startRes = await request.post("/api/recording/start", {
    data: {
      startUrl,
      urlName: "DemoLoginPage",
      target: "testMethod",
      methodName: "LoginFlow",
      newTestClassName: className,
    },
  });
  expect(
    startRes.ok(),
    `POST /recording/start failed: ${startRes.status()} ${await startRes.text()}`,
  ).toBe(true);

  // The dev-fixture page self-fires its events ~250ms after load.
  // Wait long enough for: page nav (≤1s in headless) + fixture timer
  // (250ms) + DOM event broadcast → server push (immediate). 1.5s
  // gives a comfortable margin without padding the suite.
  await page.waitForTimeout(1_500);

  const stopRes = await request.post("/api/recording/stop");
  expect(
    stopRes.ok(),
    `POST /recording/stop failed: ${stopRes.status()} ${await stopRes.text()}`,
  ).toBe(true);

  // Force the workbench to immediately re-query /recording/status
  // instead of waiting up to the 2.5s refetchInterval. Reloading
  // remounts the Workbench page, which will see phase="stopped" on
  // its first status fetch and mount RecordingCanvas — which in turn
  // opens /ws/recording, triggering the attachSocket-side feedReset
  // snapshot that populates the ActionsFeed.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await dismissTransientUi(page);
  await page.waitForSelector("[data-testid='action-feed-item-0']", {
    timeout: 10_000,
  });
  await page.waitForTimeout(200);
}

/**
 * Tear down the recording session created by
 * `driveRealRecordingForCapture`. Idempotent — discarding when no
 * session exists is a no-op (the route returns `{ discarded: false }`).
 * Call this after screenshotting any entry that drove a real
 * recording so the next entry sees a clean phase=idle session.
 */
async function discardCaptureRecording(
  request: APIRequestContext,
): Promise<void> {
  await request.post("/api/recording/discard").catch(() => {});
}

/**
 * Drive the workbench UI into the state each per-section screenshot
 * should depict. Returns true if a custom drive ran (and the page is
 * already in the right state for capture); false if the caller should
 * just screenshot the page as-is.
 *
 * Keep these branches in sync with the matrix entries that omit a
 * `screenshotKey` (so the harness writes one JPEG per sectionId).
 */
async function driveWorkbenchSection(
  page: Page,
  request: APIRequestContext,
  entry: DocsMatrixEntry,
): Promise<boolean> {
  if (entry.route !== "/workbench") return false;
  switch (entry.sectionId) {
    case "workbench-edit-steps": {
      await driveRealRecordingForCapture(page, request);
      // The recorded fixture produces 4 rows
      // (navigate → fill → fill → click). Focus the third row
      // (index = server-assigned index of the second fill) so its
      // per-row edit toolbar (rename / move / duplicate / insert /
      // edit / delete) is visually highlighted via the same focus
      // ring the live UI applies on click. Server indices are
      // assigned in capture order, including the leading navigate,
      // so the third visible row is server index 2.
      await page
        .locator("[data-testid='action-feed-item-2']")
        .click({ force: true })
        .catch(() => {});
      // Hover the row so its inline edit buttons are also drawn with
      // the hover-elevate background, matching what a reader sees
      // when they're about to click one.
      await page
        .locator("[data-testid='action-feed-item-2']")
        .hover()
        .catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
    case "workbench-assertions": {
      await driveRealRecordingForCapture(page, request);
      // Open the Add-assertion dialog by clicking the in-app
      // toolbar trigger ("Add assertion") — it is only enabled while
      // `phase === "stopped"`, which the real recording above puts
      // us in. The dialog itself is the visual focus of the
      // assertions doc section.
      await page
        .locator("[data-testid='button-add-assertion']")
        .click({ force: true })
        .catch(() => {});
      await page.waitForSelector("[data-testid='dialog-add-assertion']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(200);
      return true;
    }
    case "workbench-run-all": {
      // The toolbar's Actions menu now houses Validate; opening it
      // and clicking the Validate item opens the right-side sheet
      // listing every recording with a "Validate all" button at the
      // top — the visual focus of the "Run all tests" doc section.
      await page
        .locator("[data-testid='button-workbench-actions-menu']")
        .click();
      await page.locator("[data-testid='button-open-validation']").click();
      await page.waitForSelector("[data-testid='sheet-validation-panel']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(300);
      return true;
    }
    case "workbench-api-build-test-python":
    case "workbench-api-build-test-nodejs":
    case "workbench-api-build-test-java": {
      // Mid-iteration project switch: the per-language Build Test
      // screenshot needs the matching API solution loaded as the
      // current project. The bootstrap above scaffolded one per
      // language; load it via /api/projects/load and reload the
      // workbench so the toolbar picks up the new solutionType.
      const language: ApiDocLanguage =
        entry.sectionId === "workbench-api-build-test-python"
          ? "python"
          : entry.sectionId === "workbench-api-build-test-nodejs"
            ? "nodejs"
            : "java";
      const slnPath = API_DOC_TARGETS.get(language);
      expect(
        slnPath,
        `bootstrapWorkbenchTargets did not register an API doc-capture project for ${language}`,
      ).toBeTruthy();
      const loadRes = await request.post("/api/projects/load", {
        data: { slnPath },
      });
      expect(
        loadRes.ok(),
        `[${entry.sectionId}] POST /projects/load (${slnPath}) failed: ${loadRes.status()} ${await loadRes.text()}`,
      ).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      await dismissTransientUi(page);
      await page.waitForSelector("[data-testid='button-build-test']", {
        timeout: 10_000,
      });
      await page
        .locator("[data-testid='button-build-test']")
        .click({ force: true });
      // The Build Test dialog is identified by its title — wait for
      // a step-1 field to confirm it is open and stable.
      await page.waitForSelector("[data-testid='input-endpoint-name']", {
        timeout: 10_000,
      });
      await page.waitForTimeout(300);
      return true;
    }
    case "workbench-api-checks": {
      // Drive a real recording so the toolbar's "Add API check"
      // button is enabled (it requires phase=stopped), then open the
      // dialog — the visual focus of the API-checks doc section.
      await driveRealRecordingForCapture(page, request);
      await page
        .locator("[data-testid='button-add-api-check']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='dialog-add-api-check']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(200);
      return true;
    }
    case "workbench-accessibility": {
      // Open the Add-assertion dialog and pick the
      // `Accessibility (axe-core)` kind so the impact-level dropdown
      // is visible — the visual focus of the accessibility doc
      // section.
      await driveRealRecordingForCapture(page, request);
      await page
        .locator("[data-testid='button-add-assertion']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='dialog-add-assertion']", {
        timeout: 5_000,
      });
      // Radix RadioGroupItem renders a button with role=radio whose
      // click target is a small dot. Use the wrapping <label> text so
      // the click lands on the label and the browser's native label
      // semantics forward it to the radio (matches what a user does).
      await page
        .locator("label", { hasText: /^Accessibility \(axe-core scan\)$/ })
        .click();
      // Wait for the impact-level Select to render (only mounts after
      // the radio selects accessibility).
      await page.waitForSelector("[data-testid='select-axe-impact']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(200);
      return true;
    }
    case "workbench-branches": {
      // The earlier `workbench-api-build-test-*` entries switched the
      // active project to a per-language API solution (no .git). Pull
      // the role's git-init'd DocCaptureProject back in before opening
      // the dropdown — otherwise BranchDropdown returns null because
      // `hasGitWorkingCopy` is false for the API project.
      const docSln = CURRENT_ROLE_WORKBENCH_TARGET;
      expect(
        docSln,
        "workbench-branches: CURRENT_ROLE_WORKBENCH_TARGET was not set before iteration",
      ).toBeTruthy();
      const loadBack = await request.post("/api/projects/load", {
        data: { slnPath: docSln },
      });
      expect(
        loadBack.ok(),
        `workbench-branches: POST /projects/load (${docSln}) failed: ${loadBack.status()} ${await loadBack.text()}`,
      ).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      await dismissTransientUi(page);
      // The BranchDropdown only renders when the active project is a
      // git working copy; `bootstrapWorkbenchTargets` `git init`s
      // both the shared dir and the limited user's fork dir, so the
      // toolbar button is present for every role. Click it to open
      // the dropdown panel (current branch + branch list + Create
      // branch row) — the visual focus of the branches doc section.
      await page.waitForSelector("[data-testid='button-branch-dropdown']", {
        timeout: 10_000,
      });
      await page
        .locator("[data-testid='button-branch-dropdown']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='branch-dropdown-menu']", {
        timeout: 5_000,
      });
      // Park the mouse off the menu so no item picks up a transient
      // hover background (same trick used by other dropdown shots).
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      return true;
    }
    case "workbench-keep-browser-open": {
      // Open the Start Recording dialog in its fresh-flow state and
      // scroll to the new "Keep browser open after stop recording
      // button is clicked" checkbox so the doc's main screenshot
      // depicts the checkbox section (unchecked).
      await page.waitForSelector("[data-testid='button-start-recording']", {
        timeout: 10_000,
      });
      await page
        .locator("[data-testid='button-start-recording']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='section-keep-browser-open']", {
        timeout: 5_000,
      });
      await page
        .locator("[data-testid='section-keep-browser-open']")
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
    case "workbench-visual-baseline": {
      // Open the Add-assertion dialog and pick the `Visual baseline`
      // kind so the baseline-name + threshold form is visible — the
      // visual focus of the visual-baseline doc section.
      await driveRealRecordingForCapture(page, request);
      await page
        .locator("[data-testid='button-add-assertion']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='dialog-add-assertion']", {
        timeout: 5_000,
      });
      await page
        .locator("label", {
          hasText: /^Visual regression vs\. baseline$/,
        })
        .click();
      // Wait for the per-kind form fields to render (only mount once
      // the radio selects visual-baseline).
      await page.waitForSelector("#visual-name", { timeout: 5_000 });
      await page.waitForTimeout(200);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Drive the Workbench into the state each `additionalScreenshotKeys`
 * key on an entry should depict. Called after the main screenshot has
 * already been written, so any setup the main shot left behind (e.g.
 * the Start Recording dialog open) is the starting state.
 */
async function driveWorkbenchAdditionalScreenshot(
  page: Page,
  _request: APIRequestContext,
  entry: DocsMatrixEntry,
  extraKey: string,
): Promise<void> {
  if (
    entry.sectionId === "workbench-keep-browser-open" &&
    extraKey === "workbench-keep-browser-open-attach"
  ) {
    // Main shot left the fresh-flow Start Recording dialog open.
    // Close it, open a pre-attach browser via the Actions menu, then
    // reopen Start Recording in attach mode so the locked Suite +
    // Target controls and the `note-attach-open-browser` banner are
    // visible.
    await page
      .locator("button:has-text('Cancel')")
      .first()
      .click({ force: true })
      .catch(() => {});
    await page.waitForTimeout(200);
    await page
      .locator("[data-testid='button-workbench-actions-menu']")
      .click({ force: true });
    await page
      .locator("[data-testid='button-open-browser']")
      .click({ force: true });
    await page.waitForSelector("[data-testid='button-open-browser-confirm']", {
      timeout: 5_000,
    });
    await page
      .locator("[data-testid='button-open-browser-confirm']")
      .click({ force: true });
    await page.waitForSelector(
      "[data-testid='button-start-recording-attach']",
      { timeout: 20_000 },
    );
    await page
      .locator("[data-testid='button-start-recording-attach']")
      .click({ force: true });
    await page.waitForSelector("[data-testid='note-attach-open-browser']", {
      timeout: 5_000,
    });
    await page.waitForTimeout(300);
    return;
  }
  throw new Error(
    `No additional-screenshot driver registered for entry '${entry.sectionId}' key '${extraKey}'. ` +
      `Add a case in driveWorkbenchAdditionalScreenshot in capture.spec.ts.`,
  );
}

/**
 * Drive home-page-anchored sections (`/`) into the state each
 * dedicated screenshot should depict. Mirrors `driveWorkbenchSection`
 * but for the projects landing page.
 */
async function driveHomeSection(
  page: Page,
  entry: DocsMatrixEntry,
): Promise<boolean> {
  if (entry.route !== "/") return false;
  switch (entry.sectionId) {
    case "home-new-project-api-language": {
      // Open the New Project dialog, switch the solution-type to API,
      // then open the Language select so all four language options
      // (C# / Python / Node.js / Java) are visible in the screenshot.
      await page.waitForSelector("[data-testid='button-new-project']", {
        timeout: 10_000,
      });
      await page
        .locator("[data-testid='button-new-project']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='radio-solution-type-api']", {
        timeout: 5_000,
      });
      await page
        .locator("[data-testid='radio-solution-type-api']")
        .click({ force: true });
      // Open the Language Select so the dropdown options are visible.
      await page
        .locator("[data-testid='select-language']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='option-language-java']", {
        timeout: 5_000,
      });
      // Park the mouse off-screen so no option in the open Select
      // gets a transient hover background — a frequent source of
      // sub-3% drift on the New-project dialog screenshot.
      await page.mouse.move(1, 1);
      // Drop focus from any input/button so caret-blink and focus-ring
      // animations don't introduce sub-3% drift between Chromium runs.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        const style = document.createElement("style");
        style.textContent =
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
        document.head.appendChild(style);
      });
      await page.waitForTimeout(1200);
      return true;
    }
    case "home-demo-project": {
      // Scroll the Try-the-demo card into the top of the viewport so
      // the dedicated shot focuses on it (it sits above the projects
      // list on the admin home but the projects table can push it
      // partially out of frame).
      await page.waitForSelector("[data-testid='card-try-the-demo']", {
        timeout: 10_000,
      });
      await page.evaluate(() => {
        const el = document.querySelector(
          "[data-testid='card-try-the-demo']",
        );
        el?.scrollIntoView({
          behavior: "instant" as ScrollBehavior,
          block: "start",
        });
        window.scrollBy(0, -80); // leave room for the sticky top nav
      });
      await page.waitForTimeout(200);
      return true;
    }
    case "onboarding-tour": {
      // The harness pre-marks every seeded user as having seen the
      // tour (so transient overlays don't block other captures).
      // Re-open it via the same window event the user-menu's
      // "Take the tour" item dispatches, so the documented overlay
      // is captured exactly as a user would see it.
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("onboarding:relaunch"));
      });
      await page.waitForSelector("[data-testid='onboarding-tour-overlay']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(200);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Drive settings-page-anchored sections (`/settings`) that need more
 * than just expanding their CollapsibleSection — e.g. opening the
 * editor dialog whose form is the visual focus of the section.
 */
async function driveSettingsSection(
  page: Page,
  entry: DocsMatrixEntry,
): Promise<boolean> {
  if (entry.route === "/admin" && entry.sectionId === "admin-my-fork") {
    // The MyForkSection only renders inside the per-project Git Repos
    // editor dialog. The git-repos section is already expanded by
    // `openSettingsSection("git-repos")` upstream; click the
    // doc-capture project's "Configure" / "Edit" pencil to open the
    // dialog where the my-fork panel lives.
    const editBtn = page.locator(
      `[data-testid='button-git-repos-edit-${DOC_CAPTURE_PROJECT}']`,
    );
    await editBtn.waitFor({ timeout: 10_000 });
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.click({ force: true });
    const forkSection = page.locator(
      `[data-testid='section-my-fork-${DOC_CAPTURE_PROJECT}']`,
    );
    await forkSection.waitFor({ timeout: 10_000 });
    await forkSection.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(200);
    return true;
  }
  if (entry.route !== "/settings") return false;
  switch (entry.sectionId) {
    case "settings-mocks": {
      // The mocks editor dialog is the visual focus of this doc
      // section. Click "Add mock" inside the (already-expanded)
      // mocks section to open the empty editor form.
      await page
        .locator("[data-testid='button-add-mock']")
        .click({ force: true });
      await page.waitForSelector("[data-testid='dialog-edit-mock']", {
        timeout: 5_000,
      });
      await page.waitForTimeout(200);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Capture the signed-out Landing page in an isolated, cookie-less
 * browser context so the JPEG actually shows the marketing surface
 * instead of the role-aware Home (which is what `/` resolves to once
 * the AuthGate sees a session). Writes one JPEG per role even though
 * the page is identical — the docs sidebar gates entries by role and
 * `screenshotSrc()` is per-role, so every visible role still needs a
 * file on disk under its own directory.
 */
/**
 * Volatile-region masks for `page.screenshot({ mask })`.
 *
 * Some documented surfaces include data that genuinely changes from
 * one capture run to the next (audit-log timestamps, "last login"
 * times, recording lists that grow with leftover state). Masking
 * those regions in BOTH the committed baseline and every fresh
 * capture keeps the docs:screenshots:check gate stable without
 * having to lower the global pixel-diff tolerance.
 *
 * The mask is painted with `maskColor` directly into the JPEG, so
 * baseline + fresh captures always agree byte-for-byte over the
 * masked area regardless of the underlying DOM content.
 */
function masksForEntry(page: Page, entry: DocsMatrixEntry): Locator[] {
  const masks: Locator[] = [];
  if (
    entry.route === "/settings" &&
    entry.settingsSectionTestId === "activity"
  ) {
    // Audit-event timestamps + the row set itself grow on every run.
    masks.push(page.locator("[data-testid='section-activity'] table"));
    masks.push(
      page.locator(
        "[data-testid='section-activity'] [data-testid='audit-empty']",
      ),
    );
    // "Showing page X • N events" footer just below the table.
    masks.push(
      page.locator(
        "[data-testid='section-activity'] .text-muted-foreground.text-xs",
      ),
    );
  }
  if (
    entry.route === "/settings" &&
    entry.settingsSectionTestId === "users"
  ) {
    // The "Last Login" column renders `toLocaleString()` on a real
    // timestamp that updates every time a seeded user signs in (which
    // the harness itself does on every run). Mask the entire wrapping
    // card — not just the inner `<table>` — so:
    //   - the loading-spinner branch and the rendered-table branch
    //     both get the same flat fill (the section-users body
    //     swaps between `<Loader2 />` and `<Table>` depending on
    //     `useListUsers` cache state),
    //   - sub-pixel layout differences and JPEG compression
    //     artifacts at the mask boundary land on the card border
    //     instead of inside the table, where they were previously
    //     pushing the diff over the 2.5% tolerance.
    masks.push(
      page.locator(
        "[data-testid='section-users'] .rounded-md.border.bg-card",
      ),
    );
  }
  if (entry.route === "/workbench") {
    // The right-side "Test Suites" panel lists test classes/methods
    // discovered on disk. Even with a deterministic seed project,
    // ordering and per-method icons render with subpixel differences
    // that exceed the 2.5% tolerance for a small panel. Mask the
    // entire panel so the workbench bare + scripted captures stay
    // stable; the panel itself is documented separately on the
    // Workbench docs page.
    masks.push(page.locator("[data-testid='workbench-right-panel']"));
  }
  return masks;
}

async function captureLandingEntry(
  browser: Browser,
  role: AuthUserRole,
  entry: DocsMatrixEntry,
): Promise<void> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(entry.route, { waitUntil: "domcontentloaded" });
    // The Landing component renders the `landing-logo` testid only
    // when no session is present. Waiting for it both proves the
    // signed-out surface rendered and gives the AuthGate a frame to
    // settle without redirecting.
    await page.waitForSelector("[data-testid='landing-logo']", {
      timeout: 10_000,
    });
    expect(
      page.url().endsWith(entry.route),
      `[${role}] signed-out navigation to ${entry.route} ended at ${page.url()}; expected the Landing surface.`,
    ).toBe(true);
    await dismissTransientUi(page);
    const out = screenshotPath(role, screenshotKey(entry));
    await ensureDir(out);
    await page.screenshot({
      path: out,
      type: "jpeg",
      quality: 82,
      fullPage: false,
      mask: masksForEntry(page, entry),
      maskColor: "#9ca3af",
    });
  } finally {
    await ctx.close();
  }
}

async function captureEntry(
  browser: Browser,
  page: Page,
  request: APIRequestContext,
  role: AuthUserRole,
  entry: DocsMatrixEntry,
): Promise<void> {
  // The landing page is the only entry that documents a signed-out
  // surface. Capture it in a throwaway, cookie-less context so the
  // signed-in `page` (and its session) is left untouched for the rest
  // of the role's matrix iteration.
  if (entry.sectionId === "landing") {
    await captureLandingEntry(browser, role, entry);
    return;
  }

  const finalUrl = await navigateAndStabilize(page, entry.route);

  // STRICT REACHABILITY: if the matrix says this role can see this
  // entry, the route MUST be reachable for that role. Any redirect
  // means the matrix's `allowedRoles` and the page's runtime guard
  // disagree — fail loudly so docs and UI cannot drift.
  //
  // /settings is the only legitimately "fuzzy" route because each
  // matrix entry corresponds to a sub-section anchored on the same
  // page; the post-condition is the same (URL ends in /settings).
  expect(
    finalUrl.endsWith(entry.route),
    `[${role}] navigation to ${entry.route} ended at ${finalUrl}. ` +
      `The matrix declares this route visible to ${role}, but the page redirected. ` +
      `Either fix the page's role guard, change matrix.allowedRoles, or — for /workbench — fix bootstrapWorkbenchTargets.`,
  ).toBe(true);

  if (entry.route === "/settings" || entry.route === "/admin") {
    // Both pages use `<CollapsibleSection testId="X">` (rendered as
    // `data-testid="settings-section-X"`), so the same helpers drive
    // either: verify matrix↔visible parity for the role's
    // sub-sections, then open exactly the one we are documenting.
    await auditSettingsSections(page, role, entry.route);
    if (entry.settingsSectionTestId) {
      await openSettingsSection(page, entry.settingsSectionTestId);
    }
  }

  // The recording session is a global server singleton — leaving one
  // live (e.g. because a per-section drive throws mid-flight) blocks
  // every subsequent role's POST /recording/start with "already in
  // progress". Always discard in `finally`, regardless of whether the
  // drive completed or threw, so a single failing capture does not
  // poison the rest of the run.
  try {
    await driveWorkbenchSection(page, request, entry);
    await driveHomeSection(page, entry);
    await driveSettingsSection(page, entry);

    const out = screenshotPath(role, screenshotKey(entry));
    await ensureDir(out);
    await page.screenshot({
      path: out,
      type: "jpeg",
      quality: 82,
      fullPage: false,
      mask: masksForEntry(page, entry),
      maskColor: "#9ca3af",
    });

    // Drive any additional-screenshot states declared on the entry
    // and capture one extra JPEG per `additionalScreenshotKeys` key,
    // in declaration order.
    for (const extraKey of entry.additionalScreenshotKeys ?? []) {
      await driveWorkbenchAdditionalScreenshot(page, request, entry, extraKey);
      const extraOut = screenshotPath(role, extraKey);
      await ensureDir(extraOut);
      await page.screenshot({
        path: extraOut,
        type: "jpeg",
        quality: 82,
        fullPage: false,
        mask: masksForEntry(page, entry),
        maskColor: "#9ca3af",
      });
    }
  } finally {
    if (entry.route === "/workbench") {
      await discardCaptureRecording(request);
      // Defensive: the keep-browser-open follow-up shot leaves a
      // pre-attach open-browser session alive; tear it down so the
      // next role's iteration doesn't trip the single-flight guard.
      await request
        .post("/api/recording/cancel-open-browser")
        .catch(() => {});
    }
  }
}

test.beforeAll(async () => {
  await bootstrapWorkbenchTargets();
});

for (const seed of SEEDED_USERS) {
  test.describe(`role=${seed.role}`, () => {
    test(`captures every visible documentation section`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const request = context.request;

      // Defensive cross-role recording cleanup. The api-server stores a
      // single in-memory recording session shared across users, and the
      // per-user /recording/discard route refuses to touch a session
      // owned by someone else. A session left dangling by a previous
      // role (or a previous test run) would therefore block this
      // role's /recording/start with "Recording already in progress".
      // Sign in as admin once and use the admin-only force-discard
      // endpoint to clear any leftover session regardless of owner.
      const adminSeed = SEEDED_USERS.find((s) => s.role === "admin")!;
      await devLogin(request, adminSeed.email, "admin");
      const forceRes = await request.post("/api/recording/force-discard");
      expect(
        forceRes.ok(),
        `cross-role POST /recording/force-discard failed: ${forceRes.status()} ${await forceRes.text()}`,
      ).toBe(true);

      // Sign in via the dev-login bypass. The session cookie is set
      // on the context and reused for the page navigations below.
      await devLogin(request, seed.email, seed.role);

      // Load the per-role doc-capture project so /workbench resolves.
      await loadDocProjectFor(request, seed.role);
      CURRENT_ROLE_WORKBENCH_TARGET =
        WORKBENCH_TARGETS.get(seed.role) ?? null;

      const page = await context.newPage();
      const visible = entriesForRole(seed.role);
      for (const entry of visible) {
        await captureEntry(browser, page, request, seed.role, entry);
      }

      // Final coverage assert: every entry the matrix says this role
      // can see MUST have produced a screenshot on disk. There are no
      // skip exemptions — captureEntry already fails loudly on any
      // redirect, so this is a defense-in-depth check that the file
      // was actually written.
      for (const entry of visible) {
        const out = screenshotPath(seed.role, screenshotKey(entry));
        expect(
          existsSync(out),
          `[${seed.role}] expected screenshot was not written: ${out}`,
        ).toBe(true);
      }
      await context.close();
    });
  });
}

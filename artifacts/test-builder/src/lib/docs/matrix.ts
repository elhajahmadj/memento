import type { AuthUserRole } from "@workspace/api-client-react";
  import { entry as landing } from "./matrix/landing";
import { entry as dashboard } from "./matrix/dashboard";
import { entry as home } from "./matrix/home";
import { entry as workbench } from "./matrix/workbench";
import { entry as workbench_generate_pipeline_file } from "./matrix/workbench-generate-pipeline-file";
import { entry as workbench_edit_steps } from "./matrix/workbench-edit-steps";
import { entry as workbench_assertions } from "./matrix/workbench-assertions";
import { entry as workbench_run_all } from "./matrix/workbench-run-all";
import { entry as workbench_api_checks } from "./matrix/workbench-api-checks";
import { entry as workbench_api_solutions } from "./matrix/workbench-api-solutions";
import { entry as workbench_api_build_test_python } from "./matrix/workbench-api-build-test-python";
import { entry as workbench_api_build_test_nodejs } from "./matrix/workbench-api-build-test-nodejs";
import { entry as workbench_api_build_test_java } from "./matrix/workbench-api-build-test-java";
import { entry as workbench_accessibility } from "./matrix/workbench-accessibility";
import { entry as workbench_visual_baseline } from "./matrix/workbench-visual-baseline";
import { entry as workbench_open_browser } from "./matrix/workbench-open-browser";
import { entry as workbench_keep_browser_open } from "./matrix/workbench-keep-browser-open";
import { entry as workbench_fix_broken_step } from "./matrix/workbench-fix-broken-step";
import { entry as home_new_project_clone_repo } from "./matrix/home-new-project-clone-repo";
import { entry as workbench_branches } from "./matrix/workbench-branches";
import { entry as home_new_project_api_language } from "./matrix/home-new-project-api-language";
import { entry as home_new_project_jmx } from "./matrix/home-new-project-jmx";
import { entry as home_demo_project } from "./matrix/home-demo-project";
import { entry as onboarding_tour } from "./matrix/onboarding-tour";
import { entry as admin } from "./matrix/admin";
import { entry as admin_manage_projects } from "./matrix/admin-manage-projects";
import { entry as admin_users } from "./matrix/admin-users";
import { entry as admin_team } from "./matrix/admin-team";
import { entry as admin_git_repos } from "./matrix/admin-git-repos";
import { entry as admin_repos_pat } from "./matrix/admin-repos-pat";
import { entry as admin_my_fork } from "./matrix/admin-my-fork";
import { entry as admin_approval } from "./matrix/admin-approval";
import { entry as admin_lifecycle_requests } from "./matrix/admin-lifecycle-requests";
import { entry as admin_fork_requests } from "./matrix/admin-fork-requests";
import { entry as admin_project_assignments } from "./matrix/admin-project-assignments";
import { entry as settings_architectures } from "./matrix/settings-architectures";
import { entry as settings_recording } from "./matrix/settings-recording";
import { entry as settings_validation } from "./matrix/settings-validation";
import { entry as settings_appearance } from "./matrix/settings-appearance";
import { entry as settings_mocks } from "./matrix/settings-mocks";
import { entry as tools } from "./matrix/tools";
import { entry as tools_ai_agent } from "./matrix/tools-ai-agent";
import { entry as tools_ai_assists } from "./matrix/tools-ai-assists";
import { entry as workbench_ai_run } from "./matrix/workbench-ai-run";
import { entry as tools_validation_traces } from "./matrix/tools-validation-traces";
import { entry as tools_internal_tests } from "./matrix/tools-internal-tests";
import { entry as tools_test_runs } from "./matrix/tools-test-runs";
import { entry as settings_activity } from "./matrix/settings-activity";
import { entry as settings_maintenance } from "./matrix/settings-maintenance";
import { entry as my_approvals } from "./matrix/my-approvals";
import { entry as profile } from "./matrix/profile";
import { entry as about } from "./matrix/about";

  /**
   * Single source of truth for the role × page documentation matrix.
   *
   * Every user-facing page or visible section that has a documentation entry
   * lives here. The same module powers:
   *
   * - the Documentation page sidebar (which sections to show per role),
   * - the auto-generated "Permissions" note rendered on each section,
   * - the Playwright screenshot harness (`e2e-docs/`) — which reads this
   *   matrix to know which routes/sections to visit per role and what
   *   filename to write the screenshot to,
   * - the route/section consistency unit test that fails the build if
   *   `App.tsx` adds a route without a matching matrix entry.
   *
   * Role-gating rules MUST mirror the actual `useIsAdmin` /
   * `useIsAnyAdmin` / `useIsLimitedAdmin` redirects performed by the real
   * pages. The Documentation page calls those same hooks at render time —
   * this matrix is what tells the sidebar which entries are even
   * candidates to show.
   *
   * Each individual section's entry lives in its own file under
   * `./matrix/<sectionId>.ts`; this index re-assembles them into the
   * same aggregate array consumers used before the split.
   */
  export type DocsCategory =
    | "Workspace"
    | "Admin"
    | "Settings"
    | "Tools"
    | "Account"
    | "About";

  /**
   * One row of the matrix. A `route` may be shared across multiple entries
   * (e.g. several Settings sub-sections all live under `/settings`); the
   * `settingsSectionTestId` discriminator tells the screenshot harness
   * which collapsible to expand before capturing.
   */
  export interface DocsMatrixEntry {
    /** Unique kebab-case id, also used in the URL (`/documentation/<id>`). */
    sectionId: string;
    /** Sidebar label. */
    label: string;
    /** Sidebar grouping. */
    category: DocsCategory;
    /** Route the section documents (used by the screenshot harness). */
    route: string;
    /**
     * Roles allowed to reach the route in the real app. Drives both
     * sidebar visibility and the auto-permissions note.
     */
    allowedRoles: AuthUserRole[];
    /**
     * Filename basename written by the harness:
     * `public/images/docs/<role>/<screenshotKey>.jpg`. Defaults to
     * `sectionId` when unset.
     */
    screenshotKey?: string;
    /**
     * Additional screenshot filenames rendered after the main one in the
     * documentation page. Use for sections that need more than one image
     * to describe a flow (e.g. before / after a state change). Each entry
     * resolves to `public/images/docs/<role>/<key>.jpg`, same as
     * `screenshotKey`.
     */
    additionalScreenshotKeys?: string[];
    /**
     * For tabbed/sectioned pages (today: Settings) — the `data-testid`
     * suffix of the `CollapsibleSection` to expand before screenshotting.
     * The Settings page uses `<CollapsibleSection testId="architectures">`
     * which renders as `data-testid="settings-section-architectures"`.
     */
    settingsSectionTestId?: string;
    /**
     * If true, the section requires a project to be loaded before the
     * route renders meaningfully (today: `/workbench`). The harness
     * scaffolds a demo project per role before navigating.
     */
    requiresProject?: boolean;
  }

  /**
   * The matrix. Order matters: the sidebar renders entries in this order
   * (grouped by `category`), so adjust positions intentionally.
   */
  export const DOCS_MATRIX: DocsMatrixEntry[] = [
    landing,
  dashboard,
  home,
  workbench,
  workbench_generate_pipeline_file,
  workbench_edit_steps,
  workbench_assertions,
  workbench_run_all,
  workbench_api_checks,
  workbench_api_solutions,
  workbench_api_build_test_python,
  workbench_api_build_test_nodejs,
  workbench_api_build_test_java,
  workbench_accessibility,
  workbench_visual_baseline,
  workbench_open_browser,
  workbench_keep_browser_open,
  workbench_fix_broken_step,
  home_new_project_clone_repo,
  workbench_branches,
  home_new_project_api_language,
  home_new_project_jmx,
  home_demo_project,
  onboarding_tour,
  admin,
  admin_manage_projects,
  admin_users,
  admin_team,
  admin_git_repos,
  admin_repos_pat,
  admin_my_fork,
  admin_approval,
  admin_lifecycle_requests,
  admin_fork_requests,
  admin_project_assignments,
  settings_architectures,
  settings_recording,
  settings_validation,
  settings_appearance,
  settings_mocks,
  tools,
  tools_ai_agent,
  tools_ai_assists,
  workbench_ai_run,
  tools_validation_traces,
  tools_internal_tests,
  tools_test_runs,
  settings_activity,
  settings_maintenance,
  my_approvals,
  profile,
  about,
  ];

  /** All known section IDs. */
  export const DOCS_SECTION_IDS = DOCS_MATRIX.map((e) => e.sectionId);

  /** Look up a single matrix entry by section id. */
  export function getMatrixEntry(sectionId: string): DocsMatrixEntry | undefined {
    return DOCS_MATRIX.find((e) => e.sectionId === sectionId);
  }

  /** All entries the given role can reach in the live app. */
  export function entriesForRole(role: AuthUserRole | null): DocsMatrixEntry[] {
    if (role === null) return [];
    return DOCS_MATRIX.filter((e) => e.allowedRoles.includes(role));
  }

  /** Group `entries` by category, preserving the matrix's natural order. */
  export function groupByCategory(
    entries: DocsMatrixEntry[],
  ): { category: DocsCategory; entries: DocsMatrixEntry[] }[] {
    const order: DocsCategory[] = [
      "Workspace",
      "Admin",
      "Settings",
      "Tools",
      "Account",
      "About",
    ];
    return order
      .map((category) => ({
        category,
        entries: entries.filter((e) => e.category === category),
      }))
      .filter((g) => g.entries.length > 0);
  }

  const ROLE_LABELS: Record<AuthUserRole, string> = {
    memento_admin: "Memento Admin",
    admin: "Admin",
    limited_admin: "Limited Admin",
    limited: "User",
    guest: "Guest",
  };

  /**
   * Auto-generated "Permissions" note rendered on every documentation
   * section. Sourced from `entry.allowedRoles` so the rule cannot drift
   * from the visibility check.
   */
  export function permissionsNote(entry: DocsMatrixEntry): string {
    const roles = entry.allowedRoles;
    if (roles.length === 0) return "Hidden from every role.";
    if (roles.length === ROLE_LABELS_ORDER.length) {
      return "Visible to every signed-in role (Memento Admin, Admin, Limited Admin, User).";
    }
    const labels = ROLE_LABELS_ORDER.filter((r) => roles.includes(r)).map(
      (r) => ROLE_LABELS[r],
    );
    if (labels.length === 1) return `Visible to ${labels[0]} only.`;
    const head = labels.slice(0, -1).join(", ");
    const tail = labels[labels.length - 1];
    return `Visible to ${head} and ${tail}.`;
  }

  // The roles that can actually appear in an entry's `allowedRoles`.
  // `guest` is absent on purpose: the whole documentation surface is
  // hidden from guest trial sessions, so no entry ever lists them —
  // and including it here would break the "visible to every signed-in
  // role" collapse, which compares against this list's length.
  const ROLE_LABELS_ORDER: AuthUserRole[] = [
    "memento_admin",
    "admin",
    "limited_admin",
    "limited",
  ];

  /**
   * The screenshot file basename for an entry (defaults to `sectionId`).
   */
  export function screenshotKey(entry: DocsMatrixEntry): string {
    return entry.screenshotKey ?? entry.sectionId;
  }

  /**
   * Every screenshot key for an entry, in render order: the main key
   * first, then any `additionalScreenshotKeys` the entry declares.
   */
  export function screenshotKeys(entry: DocsMatrixEntry): string[] {
    return [screenshotKey(entry), ...(entry.additionalScreenshotKeys ?? [])];
  }

  /**
   * Path the documentation page renders for a section's screenshot, given
   * the viewer's role. Returns `null` for signed-out viewers.
   *
   * The path is anchored at `basePath` (defaults to `/`) so it resolves
   * correctly even when the page is opened on a deep-link route like
   * `/documentation/settings-architectures` — without an absolute base,
   * the browser would resolve it relative to the current URL and 404.
   * Callers in the React app should pass `import.meta.env.BASE_URL` so
   * the path also respects vite's `base` configuration.
   */
  export function screenshotSrc(
    entry: DocsMatrixEntry,
    role: AuthUserRole | null,
    basePath: string = "/",
  ): string | null {
    if (role === null) return null;
    const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
    return `${base}images/docs/${role}/${screenshotKey(entry)}.jpg`;
  }

  /**
   * App routes that intentionally have NO matrix entry. The route/section
   * consistency check whitelists these so adding a future user-facing
   * route still fails the build.
   *
   * - `/login`, `/logged-out`, `/splash`, `/profile/complete` — pre-auth
   *   or onboarding transitions, not "user-facing pages a role can or
   *   cannot reach".
   * - `/documentation` — the docs page itself.
   */
  export const ROUTES_WITHOUT_DOCS: ReadonlySet<string> = new Set([
    "/login",
    "/logged-out",
    "/splash",
    "/profile/complete",
    "/documentation",
    // /pick-org is an SSO-only transition: rendered between login and
    // home for IDP users with multiple orgs. Local users never see it,
    // so the in-app docs intentionally skip it (its behavior is fully
    // documented in REQUIREMENTS.md "Authentication & profile" §).
    "/pick-org",
    // Deep-link redirect shells for the /admin governance hub. Each of
    // these immediately bounces to `/admin#<section>` (see App.tsx), so
    // the matrix entry that actually documents the panel lives on
    // `/admin`, not on the redirect path itself.
    // /dashboard is a permanent redirect to `/` — the post-login Home
    // matrix entry (sectionId `dashboard`) documents what users actually
    // see, so the redirect shell itself has no separate docs page.
    "/dashboard",
    "/admin/manage-projects",
    "/admin/users",
    "/admin/git-repos",
    "/admin/approval",
    "/admin/fork-requests",
    "/admin/project-assignments",
    // Back-compat redirect shells preserved so older /settings/... and
    // /tools/... bookmarks still land on the right /admin section.
    "/settings/manage-projects",
    "/settings/users",
    "/settings/git-repos",
    "/tools/approval",
    "/tools/fork-requests",
    "/tools/project-assignments",
    // /settings/<old-section> redirects so legacy bookmarks for the
    // sections that moved off /settings still land on the right page.
    "/settings/architectures",
    "/settings/recording",
    "/settings/validation",
    "/settings/maintenance",
    "/settings/activity",
  ]);
  
import { DOCS_MATRIX, type DocsMatrixEntry } from "./matrix";
  import { sections as landing } from "./content/landing";
import { sections as dashboard } from "./content/dashboard";
import { sections as home } from "./content/home";
import { sections as home_new_project_clone_repo } from "./content/home-new-project-clone-repo";
import { sections as workbench } from "./content/workbench";
import { sections as workbench_open_browser } from "./content/workbench-open-browser";
import { sections as workbench_keep_browser_open } from "./content/workbench-keep-browser-open";
import { sections as workbench_fix_broken_step } from "./content/workbench-fix-broken-step";
import { sections as workbench_generate_pipeline_file } from "./content/workbench-generate-pipeline-file";
import { sections as workbench_edit_steps } from "./content/workbench-edit-steps";
import { sections as workbench_assertions } from "./content/workbench-assertions";
import { sections as workbench_run_all } from "./content/workbench-run-all";
import { sections as workbench_api_checks } from "./content/workbench-api-checks";
import { sections as workbench_api_solutions } from "./content/workbench-api-solutions";
import { sections as workbench_api_build_test_python } from "./content/workbench-api-build-test-python";
import { sections as workbench_api_build_test_nodejs } from "./content/workbench-api-build-test-nodejs";
import { sections as workbench_api_build_test_java } from "./content/workbench-api-build-test-java";
import { sections as home_new_project_api_language } from "./content/home-new-project-api-language";
import { sections as home_new_project_jmx } from "./content/home-new-project-jmx";
import { sections as workbench_accessibility } from "./content/workbench-accessibility";
import { sections as workbench_visual_baseline } from "./content/workbench-visual-baseline";
import { sections as home_demo_project } from "./content/home-demo-project";
import { sections as onboarding_tour } from "./content/onboarding-tour";
import { sections as settings_appearance } from "./content/settings-appearance";
import { sections as settings_architectures } from "./content/settings-architectures";
import { sections as admin } from "./content/admin";
import { sections as admin_users } from "./content/admin-users";
import { sections as admin_team } from "./content/admin-team";
import { sections as settings_recording } from "./content/settings-recording";
import { sections as settings_validation } from "./content/settings-validation";
import { sections as settings_mocks } from "./content/settings-mocks";
import { sections as admin_manage_projects } from "./content/admin-manage-projects";
import { sections as admin_lifecycle_requests } from "./content/admin-lifecycle-requests";
import { sections as admin_git_repos } from "./content/admin-git-repos";
import { sections as admin_repos_pat } from "./content/admin-repos-pat";
import { sections as admin_my_fork } from "./content/admin-my-fork";
import { sections as workbench_branches } from "./content/workbench-branches";
import { sections as settings_maintenance } from "./content/settings-maintenance";
import { sections as settings_activity } from "./content/settings-activity";
import { sections as tools } from "./content/tools";
import { sections as admin_approval } from "./content/admin-approval";
import { sections as admin_fork_requests } from "./content/admin-fork-requests";
import { sections as admin_project_assignments } from "./content/admin-project-assignments";
import { sections as tools_validation_traces } from "./content/tools-validation-traces";
import { sections as tools_test_runs } from "./content/tools-test-runs";
import { sections as tools_internal_tests } from "./content/tools-internal-tests";
import { sections as my_approvals } from "./content/my-approvals";
import { sections as profile } from "./content/profile";
import { sections as about } from "./content/about";
import { sections as tools_ai_agent } from "./content/tools-ai-agent";
import { sections as tools_ai_assists } from "./content/tools-ai-assists";
import { sections as workbench_ai_run } from "./content/workbench-ai-run";

  /**
   * Per-section human-authored documentation content. The matrix
   * (`matrix.ts`) is the structural source of truth — this file fills in
   * the prose for every section it lists. The unit test in
   * `__tests__/content.test.ts` enforces 1-to-1 coverage so adding a
   * matrix entry without writing copy fails the build.
   *
   * Each individual section's prose lives in its own file under
   * `./content/<sectionId>.ts`; this index re-assembles them into the
   * same aggregate array consumers used before the split.
   */
  export interface DocsField {
    name: string;
    description: string;
  }

  export interface DocsSectionContent {
    /** Matches `DocsMatrixEntry.sectionId`. */
    sectionId: string;
    /** Heading shown above the screenshot in the main pane. */
    heading: string;
    /** One-paragraph "What this page is for". */
    intro: string;
    /** Numbered "How to use it" steps. */
    walkthrough: string[];
    /** "Fields & controls" reference. */
    fields: DocsField[];
  }

  const CONTENT: DocsSectionContent[] = [
    ...landing,
  ...dashboard,
  ...home,
  ...home_new_project_clone_repo,
  ...workbench,
  ...workbench_open_browser,
  ...workbench_keep_browser_open,
  ...workbench_fix_broken_step,
  ...workbench_generate_pipeline_file,
  ...workbench_edit_steps,
  ...workbench_assertions,
  ...workbench_run_all,
  ...workbench_api_checks,
  ...workbench_api_solutions,
  ...workbench_api_build_test_python,
  ...workbench_api_build_test_nodejs,
  ...workbench_api_build_test_java,
  ...home_new_project_api_language,
  ...home_new_project_jmx,
  ...workbench_accessibility,
  ...workbench_visual_baseline,
  ...home_demo_project,
  ...onboarding_tour,
  ...settings_appearance,
  ...settings_architectures,
  ...admin,
  ...admin_users,
  ...admin_team,
  ...settings_recording,
  ...settings_validation,
  ...settings_mocks,
  ...admin_manage_projects,
  ...admin_lifecycle_requests,
  ...admin_git_repos,
  ...admin_repos_pat,
  ...admin_my_fork,
  ...workbench_branches,
  ...settings_maintenance,
  ...settings_activity,
  ...tools,
  ...admin_approval,
  ...admin_fork_requests,
  ...admin_project_assignments,
  ...tools_validation_traces,
  ...tools_test_runs,
  ...tools_internal_tests,
  ...my_approvals,
  ...profile,
  ...about,
  ...tools_ai_agent,
  ...tools_ai_assists,
  ...workbench_ai_run,
  ];

  export const DOCS_CONTENT: DocsSectionContent[] = CONTENT;

  export function contentForSection(
    sectionId: string,
  ): DocsSectionContent | undefined {
    return CONTENT.find((c) => c.sectionId === sectionId);
  }

  /**
   * Convenience: pair every matrix entry with its content. Throws on
   * missing content (caught by the unit test).
   */
  export function combinedSections(): {
    entry: DocsMatrixEntry;
    content: DocsSectionContent;
  }[] {
    return DOCS_MATRIX.map((entry) => {
      const content = contentForSection(entry.sectionId);
      if (!content) {
        throw new Error(
          `No documentation content for matrix entry "${entry.sectionId}"`,
        );
      }
      return { entry, content };
    });
  }
  
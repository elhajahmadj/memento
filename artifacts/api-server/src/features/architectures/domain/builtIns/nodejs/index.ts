/**
 * Node.js default architecture builder.
 *
 * Mirrors the Python single-root layout: a flat project rooted at
 * `package.json` containing `tests/`, `pages/`, and a `shared/`
 * constants/fixtures module.
 */
import {
  type ArchProject,
  type Architecture,
  NODEJS_DEFAULT_ARCHITECTURE_ID,
} from "../../types";
import {
  NODEJS_PACKAGE_JSON_CONTENT,
  NODEJS_PLAYWRIGHT_CONFIG_CONTENT,
  NODEJS_TSCONFIG_CONTENT,
  NODEJS_SMOKE_SPEC_CONTENT,
  NODEJS_GITIGNORE_CONTENT,
  NODEJS_ENV_EXAMPLE_CONTENT,
  NODEJS_README_CONTENT,
  NODEJS_CONSTANTS_CONTENT,
  NODEJS_TEST_CONFIG_CONTENT,
  NODEJS_BROWSER_MANAGER_CONTENT,
  NODEJS_TEST_CONTEXT_HELPER_CONTENT,
  NODEJS_TEST_OUTPUT_LOGGER_CONTENT,
  NODEJS_TEST_TRACKER_CONTENT,
  NODEJS_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT,
  NODEJS_FIXTURES_CONTENT,
  NODEJS_PAGES_README_CONTENT,
} from "./templates";
import {
  NODEJS_VSCODE_SETTINGS_CONTENT,
  NODEJS_VSCODE_LAUNCH_CONTENT,
  NODEJS_VSCODE_EXTENSIONS_CONTENT,
} from "./vscode";

export * from "./templates";
export * from "./vscode";

export function buildNodejsDefaultArchitecture(): Architecture {
  const sharedProject: ArchProject = {
    id: "nodejs-default-shared",
    nameSuffix: ".shared",
    isTestsProject: false,
    slnGuid: "{B1A2D3E4-5F60-4178-9ABC-DEF0NODEJS01}",
    files: [],
    folders: [
      {
        name: "shared",
        folders: [],
        files: [
          { name: "constants.ts", content: NODEJS_CONSTANTS_CONTENT },
          { name: "testConfig.ts", content: NODEJS_TEST_CONFIG_CONTENT },
          {
            name: "browserManager.ts",
            content: NODEJS_BROWSER_MANAGER_CONTENT,
          },
          {
            name: "testContextHelper.ts",
            content: NODEJS_TEST_CONTEXT_HELPER_CONTENT,
          },
          {
            name: "testOutputLogger.ts",
            content: NODEJS_TEST_OUTPUT_LOGGER_CONTENT,
          },
          { name: "testTracker.ts", content: NODEJS_TEST_TRACKER_CONTENT },
          {
            name: "playwrightTraceExtensions.ts",
            content: NODEJS_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT,
          },
          { name: "fixtures.ts", content: NODEJS_FIXTURES_CONTENT },
        ],
      },
    ],
  };

  const infraProject: ArchProject = {
    id: "nodejs-default-infra",
    nameSuffix: ".infrastructure",
    isTestsProject: false,
    slnGuid: "{C3D8B9A1-4F5E-4E2C-9F3A-6B7DNODEJS02}",
    files: [],
    folders: [
      {
        name: "pages",
        folders: [
          { name: "selectors", folders: [], files: [] },
          { name: "actions", folders: [], files: [] },
        ],
        files: [{ name: "README.md", content: NODEJS_PAGES_README_CONTENT }],
      },
    ],
  };

  const testsProject: ArchProject = {
    id: "nodejs-default-tests",
    nameSuffix: ".tests",
    isTestsProject: true,
    slnGuid: "{D4E5F6A7-8B90-41C2-B345-6789NODEJS03}",
    files: [
      { name: "package.json", content: NODEJS_PACKAGE_JSON_CONTENT },
      { name: "playwright.config.ts", content: NODEJS_PLAYWRIGHT_CONFIG_CONTENT },
      { name: "tsconfig.json", content: NODEJS_TSCONFIG_CONTENT },
      { name: ".gitignore", content: NODEJS_GITIGNORE_CONTENT },
      { name: ".env.example", content: NODEJS_ENV_EXAMPLE_CONTENT },
      { name: "README.md", content: NODEJS_README_CONTENT },
    ],
    folders: [
      {
        name: "tests",
        folders: [],
        files: [{ name: "smoke.spec.ts", content: NODEJS_SMOKE_SPEC_CONTENT }],
      },
      {
        name: "constants",
        folders: [],
        files: [{ name: ".gitkeep", content: "" }],
      },
      {
        name: "test-categories",
        folders: [],
        files: [{ name: ".gitkeep", content: "" }],
      },
      {
        name: ".vscode",
        folders: [],
        files: [
          { name: "settings.json", content: NODEJS_VSCODE_SETTINGS_CONTENT },
          { name: "launch.json", content: NODEJS_VSCODE_LAUNCH_CONTENT },
          {
            name: "extensions.json",
            content: NODEJS_VSCODE_EXTENSIONS_CONTENT,
          },
        ],
      },
    ],
  };

  return {
    id: NODEJS_DEFAULT_ARCHITECTURE_ID,
    name: "Default (Node.js)",
    isBuiltIn: true,
    language: "nodejs",
    projects: [infraProject, sharedProject, testsProject],
  };
}

export const NODEJS_DEFAULT_ARCHITECTURE: Architecture = {
  ...buildNodejsDefaultArchitecture(),
  solutionType: "playwright",
};

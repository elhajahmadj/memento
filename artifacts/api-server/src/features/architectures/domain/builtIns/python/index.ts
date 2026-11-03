/**
 * Python default architecture builder.
 */
import {
  type ArchProject,
  type Architecture,
  PYTHON_DEFAULT_ARCHITECTURE_ID,
} from "../../types";
import {
  PYTHON_PYPROJECT_CONTENT,
  PYTHON_REQUIREMENTS_CONTENT,
  PYTHON_GITIGNORE_CONTENT,
  PYTHON_README_CONTENT,
  PYTHON_ENV_EXAMPLE_CONTENT,
  PYTHON_INIT_CONTENT,
  PYTHON_TEST_SMOKE_CONTENT,
  PYTHON_CONFTEST_CONTENT,
  PYTHON_TEST_FIXTURE_BASE_CONTENT,
  PYTHON_BROWSER_MANAGER_CONTENT,
  PYTHON_TEST_CONFIG_CONTENT,
  PYTHON_CONSTANTS_CONTENT,
  PYTHON_TEST_CONTEXT_HELPER_CONTENT,
  PYTHON_TEST_OUTPUT_LOGGER_CONTENT,
  PYTHON_TEST_TRACKER_CONTENT,
  PYTHON_APP_CONFIGURATION_CONTENT,
  PYTHON_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT,
} from "./templates";
import {
  PYTHON_VSCODE_SETTINGS_CONTENT,
  PYTHON_VSCODE_LAUNCH_CONTENT,
  PYTHON_VSCODE_EXTENSIONS_CONTENT,
} from "./vscode";

export * from "./templates";
export * from "./vscode";

export function buildPythonDefaultArchitecture(): Architecture {
  const sharedProject: ArchProject = {
    id: "python-default-shared",
    nameSuffix: ".shared",
    isTestsProject: false,
    slnGuid: "{B1A2D3E4-5F60-4178-9ABC-DEF0PYTHON01}",
    files: [],
    folders: [
      {
        name: "shared",
        folders: [],
        files: [
          { name: "__init__.py", content: PYTHON_INIT_CONTENT },
          { name: "test_config.py", content: PYTHON_TEST_CONFIG_CONTENT },
          { name: "constants.py", content: PYTHON_CONSTANTS_CONTENT },
          {
            name: "test_context_helper.py",
            content: PYTHON_TEST_CONTEXT_HELPER_CONTENT,
          },
          {
            name: "test_output_logger.py",
            content: PYTHON_TEST_OUTPUT_LOGGER_CONTENT,
          },
          { name: "test_tracker.py", content: PYTHON_TEST_TRACKER_CONTENT },
          {
            name: "app_configuration.py",
            content: PYTHON_APP_CONFIGURATION_CONTENT,
          },
          {
            name: "playwright_trace_extensions.py",
            content: PYTHON_PLAYWRIGHT_TRACE_EXTENSIONS_CONTENT,
          },
        ],
      },
    ],
  };

  const infraProject: ArchProject = {
    id: "python-default-infra",
    nameSuffix: ".infrastructure",
    isTestsProject: false,
    slnGuid: "{C3D8B9A1-4F5E-4E2C-9F3A-6B7DPYTHON02}",
    files: [],
    folders: [
      {
        name: "infrastructure",
        folders: [],
        files: [
          { name: "__init__.py", content: PYTHON_INIT_CONTENT },
          {
            name: "test_fixture_base.py",
            content: PYTHON_TEST_FIXTURE_BASE_CONTENT,
          },
          {
            name: "browser_manager.py",
            content: PYTHON_BROWSER_MANAGER_CONTENT,
          },
        ],
      },
    ],
  };

  const testsProject: ArchProject = {
    id: "python-default-tests",
    nameSuffix: ".tests",
    isTestsProject: true,
    slnGuid: "{D4E5F6A7-8B90-41C2-B345-6789PYTHON03}",
    files: [
      { name: "pyproject.toml", content: PYTHON_PYPROJECT_CONTENT },
      { name: "requirements.txt", content: PYTHON_REQUIREMENTS_CONTENT },
      { name: ".gitignore", content: PYTHON_GITIGNORE_CONTENT },
      { name: ".env.example", content: PYTHON_ENV_EXAMPLE_CONTENT },
      { name: "README.md", content: PYTHON_README_CONTENT },
      { name: "conftest.py", content: PYTHON_CONFTEST_CONTENT },
    ],
    folders: [
      {
        name: "tests",
        folders: [],
        files: [
          { name: "__init__.py", content: PYTHON_INIT_CONTENT },
          { name: "test_smoke.py", content: PYTHON_TEST_SMOKE_CONTENT },
        ],
      },
      {
        name: "pages",
        folders: [
          {
            name: "selectors",
            folders: [],
            files: [{ name: "__init__.py", content: PYTHON_INIT_CONTENT }],
          },
          {
            name: "actions",
            folders: [],
            files: [{ name: "__init__.py", content: PYTHON_INIT_CONTENT }],
          },
        ],
        files: [{ name: "__init__.py", content: PYTHON_INIT_CONTENT }],
      },
      {
        name: "constants",
        folders: [],
        files: [{ name: "__init__.py", content: PYTHON_INIT_CONTENT }],
      },
      {
        name: "test_categories",
        folders: [],
        files: [{ name: "__init__.py", content: PYTHON_INIT_CONTENT }],
      },
      {
        name: ".vscode",
        folders: [],
        files: [
          { name: "settings.json", content: PYTHON_VSCODE_SETTINGS_CONTENT },
          { name: "launch.json", content: PYTHON_VSCODE_LAUNCH_CONTENT },
          {
            name: "extensions.json",
            content: PYTHON_VSCODE_EXTENSIONS_CONTENT,
          },
        ],
      },
    ],
  };

  return {
    id: PYTHON_DEFAULT_ARCHITECTURE_ID,
    name: "Default (Python)",
    isBuiltIn: true,
    language: "python",
    projects: [infraProject, sharedProject, testsProject],
  };
}

export const PYTHON_DEFAULT_ARCHITECTURE: Architecture = {
  ...buildPythonDefaultArchitecture(),
  solutionType: "playwright",
};

/**
 * Java default architecture builder (Maven multi-module + JUnit 5 +
 * Playwright Java). Parent POM is generated dynamically in
 * `projectService.ts` so module names pick up the solution name.
 */
import {
  type ArchProject,
  type Architecture,
  JAVA_DEFAULT_ARCHITECTURE_ID,
} from "../../types";
import {
  JAVA_SHARED_POM_CONTENT,
  JAVA_INFRA_POM_CONTENT,
  JAVA_TESTS_POM_CONTENT,
  JAVA_APP_CONFIGURATION_CONTENT,
  JAVA_TEST_CONFIG_CONTENT,
  JAVA_TEST_OUTPUT_LOGGER_CONTENT,
  JAVA_BROWSER_MANAGER_CONTENT,
  JAVA_TEST_FIXTURE_BASE_CONTENT,
  JAVA_BROWSER_LIFECYCLE_EXTENSION_CONTENT,
  JAVA_EXAMPLE_TEST_CONTENT,
  JAVA_GITIGNORE_CONTENT,
  JAVA_ENV_EXAMPLE_CONTENT,
  JAVA_README_CONTENT,
} from "./templates";

export * from "./templates";

export function buildJavaDefaultArchitecture(): Architecture {
  const sharedProject: ArchProject = {
    id: "java-default-shared",
    nameSuffix: "-shared",
    isTestsProject: false,
    slnGuid: "{B1A2D3E4-5F60-4178-9ABC-DEF0JAVA0001}",
    files: [{ name: "pom.xml", content: JAVA_SHARED_POM_CONTENT }],
    folders: [
      {
        name: "src",
        files: [],
        folders: [
          {
            name: "main",
            files: [],
            folders: [
              {
                name: "java",
                files: [],
                folders: [
                  {
                    name: "{{Package}}",
                    files: [
                      { name: "AppConfiguration.java", content: JAVA_APP_CONFIGURATION_CONTENT },
                      { name: "TestConfig.java", content: JAVA_TEST_CONFIG_CONTENT },
                      { name: "TestOutputLogger.java", content: JAVA_TEST_OUTPUT_LOGGER_CONTENT },
                    ],
                    folders: [
                      {
                        name: "pages",
                        files: [],
                        folders: [
                          { name: "interfaces", folders: [], files: [] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const infraProject: ArchProject = {
    id: "java-default-infra",
    nameSuffix: "-infrastructure",
    isTestsProject: false,
    slnGuid: "{C3D8B9A1-4F5E-4E2C-9F3A-6B7DJAVA0002}",
    files: [{ name: "pom.xml", content: JAVA_INFRA_POM_CONTENT }],
    folders: [
      {
        name: "src",
        files: [],
        folders: [
          {
            name: "main",
            files: [],
            folders: [
              {
                name: "java",
                files: [],
                folders: [
                  {
                    name: "{{Package}}",
                    files: [],
                    folders: [
                      { name: "pages", files: [], folders: [] },
                      {
                        name: "infrastructure",
                        files: [
                          { name: "BrowserManager.java", content: JAVA_BROWSER_MANAGER_CONTENT },
                        ],
                        folders: [
                          {
                            name: "fixtures",
                            folders: [],
                            files: [
                              { name: "TestFixtureBase.java", content: JAVA_TEST_FIXTURE_BASE_CONTENT },
                              { name: "BrowserLifecycleExtension.java", content: JAVA_BROWSER_LIFECYCLE_EXTENSION_CONTENT },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const testsProject: ArchProject = {
    id: "java-default-tests",
    nameSuffix: "-tests",
    isTestsProject: true,
    slnGuid: "{D4E5F6A7-8B90-41C2-B345-6789JAVA0003}",
    files: [
      { name: "pom.xml", content: JAVA_TESTS_POM_CONTENT },
      { name: ".gitignore", content: JAVA_GITIGNORE_CONTENT },
      { name: ".env.example", content: JAVA_ENV_EXAMPLE_CONTENT },
      { name: "README.md", content: JAVA_README_CONTENT },
    ],
    folders: [
      {
        name: "src",
        files: [],
        folders: [
          {
            name: "test",
            files: [],
            folders: [
              {
                name: "java",
                files: [],
                folders: [
                  {
                    name: "{{Package}}",
                    files: [],
                    folders: [
                      {
                        name: "tests",
                        folders: [],
                        files: [{ name: "ExampleTest.java", content: JAVA_EXAMPLE_TEST_CONTENT }],
                      },
                      {
                        name: "pages",
                        files: [],
                        folders: [
                          {
                            name: "selectors",
                            folders: [],
                            files: [{ name: ".gitkeep", content: "" }],
                          },
                          {
                            name: "actions",
                            folders: [],
                            files: [{ name: ".gitkeep", content: "" }],
                          },
                        ],
                      },
                      {
                        name: "constants",
                        folders: [],
                        files: [{ name: ".gitkeep", content: "" }],
                      },
                      {
                        name: "testcategories",
                        folders: [],
                        files: [{ name: ".gitkeep", content: "" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    id: JAVA_DEFAULT_ARCHITECTURE_ID,
    name: "Default (Java)",
    isBuiltIn: true,
    language: "java",
    projects: [infraProject, sharedProject, testsProject],
  };
}

export const JAVA_DEFAULT_ARCHITECTURE: Architecture = {
  ...buildJavaDefaultArchitecture(),
  solutionType: "playwright",
};

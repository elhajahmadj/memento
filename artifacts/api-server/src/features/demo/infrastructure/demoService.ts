/**
 * "Try the demo" sample project. Scaffolds a fresh `MementoDemo` C#
 * solution for the calling user (idempotent — returns the existing one
 * when called twice) and seeds two recorded test methods plus a sample
 * route mock + accessibility assertion so newcomers can hit `Validate`
 * and see the full Tier 3 feature set in action without recording
 * anything themselves.
 *
 * The seeded actions intentionally target `https://example.com` so the
 * demo runs offline against a tiny static page that's globally cached.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  createProject,
  detectProjectInfo,
  setCurrentProject,
  type Project,
} from "@/features/projects/infrastructure/projectService";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { saveActionSet } from "@/features/recording/infrastructure/recordedActionStore";
import { createRouteMock } from "@/features/route-mocks/infrastructure/routeMockService";
import type { RecordedAction } from "@/features/codegen/infrastructure/codegen";

const DEMO_SOLUTION_NAME = "MementoDemo";
const DEMO_NAMESPACE = "MementoDemo";

const DEMO_TEST_METHODS = [
  "Demo_VisitsHomePageAndAssertsTitle",
  "Demo_RunsAccessibilityAndApiChecks",
];

const DEMO_TEST_FILE_RELATIVE = path.join(
  "MementoDemo.Tests",
  "DemoTests.cs",
);

const DEMO_START_URL = "https://example.com/";

function buildHomePageActions(): RecordedAction[] {
  return [
    { type: "navigate", url: DEMO_START_URL },
    {
      type: "assert",
      assertKind: "element-has-text",
      selector: "h1",
      assertText: "Example Domain",
    },
    {
      type: "assert",
      assertKind: "url-contains",
      assertUrl: "example.com",
    },
  ];
}

function buildA11yAndApiActions(): RecordedAction[] {
  return [
    {
      type: "routeMock",
      apiUrl: "**/api/users/me",
      apiMethod: "GET",
      mockStatus: 200,
      mockBody: JSON.stringify({
        id: "demo-1",
        username: "demo",
        role: "admin",
      }),
    },
    { type: "navigate", url: DEMO_START_URL },
    {
      type: "apiAssertion",
      apiMethod: "GET",
      apiUrl: "https://example.com/",
      apiExpectedStatus: 200,
    },
    {
      type: "assert",
      assertKind: "accessibility",
      axeImpactLevel: "serious",
    },
    {
      type: "assert",
      assertKind: "visual-baseline",
      visualName: "demo-home",
      visualThreshold: 0.05,
    },
  ];
}

export interface DemoSeedResult {
  project: Project;
  seededTestMethods: string[];
  seededMocks: string[];
}

/**
 * Idempotently scaffold the demo project for `userId`. If `MementoDemo`
 * already exists in the configured projects directory we just re-attach
 * to it as the user's current project; otherwise we build a fresh C#
 * solution and seed it.
 */
export async function ensureDemoProject(args: {
  userId: string;
}): Promise<DemoSeedResult> {
  const projectsDir = recorderConfig.workspaceDir;
  const expectedSlnPath = path.join(
    projectsDir,
    DEMO_SOLUTION_NAME,
    `${DEMO_SOLUTION_NAME}.sln`,
  );

  // `detectProjectInfo` only reads an optional marker file and otherwise
  // returns synthesised paths even when the on-disk solution doesn't
  // exist, so we have to probe the .sln itself to decide whether to
  // re-attach to an existing demo project or scaffold a fresh one.
  // Without this probe the demo flow happily "succeeds" against a
  // non-existent directory and the very next `GET /projects/tree`
  // returns a 404 — which used to leave the Explorer panel stuck on
  // an infinite "Loading…".
  let project: Project;
  let slnExists = false;
  try {
    await fs.access(expectedSlnPath);
    slnExists = true;
  } catch {
    slnExists = false;
  }
  if (slnExists) {
    project = await detectProjectInfo(expectedSlnPath);
  } else {
    project = await createProject({
      solutionName: DEMO_SOLUTION_NAME,
      namespace: DEMO_NAMESPACE,
      language: "csharp",
    });
  }

  setCurrentProject(project, args.userId);

  await saveActionSet({
    userId: args.userId,
    projectName: project.solutionName,
    filePath: DEMO_TEST_FILE_RELATIVE,
    kind: "testMethod",
    methodName: DEMO_TEST_METHODS[0]!,
    urlName: "ExampleHome",
    startUrl: DEMO_START_URL,
    actions: buildHomePageActions(),
  });

  await saveActionSet({
    userId: args.userId,
    projectName: project.solutionName,
    filePath: DEMO_TEST_FILE_RELATIVE,
    kind: "testMethod",
    methodName: DEMO_TEST_METHODS[1]!,
    urlName: "ExampleHome",
    startUrl: DEMO_START_URL,
    actions: buildA11yAndApiActions(),
  });

  const seededMocks: string[] = [];
  try {
    const mock = await createRouteMock({
      userId: args.userId,
      projectName: project.solutionName,
      name: "Demo: stub /api/users/me",
      method: "GET",
      urlPattern: "**/api/users/me",
      status: 200,
      bodyJson: { id: "demo-1", username: "demo", role: "admin" },
      enabled: true,
    });
    seededMocks.push(mock.name);
  } catch {
    // Mock seeding is best-effort: the test method already inlines a
    // routeMock action so the demo still works without a settings row.
  }

  return {
    project,
    seededTestMethods: [...DEMO_TEST_METHODS],
    seededMocks,
  };
}

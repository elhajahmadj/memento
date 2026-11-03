import { describe, it, expect } from "vitest";
import {
  buildPipelineFile,
  pipelineFilePath,
  type PipelineMode,
  type PipelinePlatform,
} from "@/features/projects/infrastructure/pipelineTemplates";
import type { Language } from "@workspace/api-zod";

const PLATFORMS: PipelinePlatform[] = [
  "github",
  "jenkins",
  "gitlab",
  "azure",
  "circleci",
];
const LANGUAGES: Language[] = ["csharp", "python", "nodejs", "java"];
const MODES: PipelineMode[] = ["ci", "cd"];

const SOLUTION_NAME = "FixtureSolution";

interface MatrixCase {
  platform: PipelinePlatform;
  language: Language;
  mode: PipelineMode;
}

const MATRIX: MatrixCase[] = PLATFORMS.flatMap((platform) =>
  LANGUAGES.flatMap((language) =>
    MODES.map((mode) => ({ platform, language, mode })),
  ),
);

describe("pipelineFilePath", () => {
  it.each([
    ["github", ".github/workflows/playwright.yml"],
    ["jenkins", "Jenkinsfile"],
    ["gitlab", ".gitlab-ci.yml"],
    ["azure", "azure-pipelines.yml"],
    ["circleci", ".circleci/config.yml"],
  ] as const)("returns the canonical path for %s", (platform, expected) => {
    expect(pipelineFilePath(platform)).toBe(expected);
  });
});

describe("buildPipelineFile snapshot matrix", () => {
  it.each(MATRIX)(
    "$platform / $language / $mode renders deterministically",
    ({ platform, language, mode }) => {
      const out = buildPipelineFile({
        platform,
        language,
        mode,
        solutionName: SOLUTION_NAME,
      });
      expect(out).toBeTypeOf("string");
      expect(out.length).toBeGreaterThan(0);
      expect(out).toMatchSnapshot();
    },
  );

  it("produces non-empty output for every combination in the matrix", () => {
    expect(MATRIX).toHaveLength(PLATFORMS.length * LANGUAGES.length * MODES.length);
    expect(MATRIX).toHaveLength(40);
  });

  it("is stable across repeated invocations (pure function)", () => {
    for (const { platform, language, mode } of MATRIX) {
      const args = {
        platform,
        language,
        mode,
        solutionName: SOLUTION_NAME,
      } as const;
      expect(buildPipelineFile(args)).toBe(buildPipelineFile(args));
    }
  });
});

describe("GitHub Actions", () => {
  it.each(LANGUAGES)("CI mode for %s does not reference drop/", (language) => {
    const out = buildPipelineFile({
      platform: "github",
      language,
      mode: "ci",
      solutionName: SOLUTION_NAME,
    });
    expect(out).toContain("uses: actions/checkout@v4");
    expect(out).toContain("uses: actions/upload-artifact@v4");
    // CI mode does not download a drop and does not depend on a build job.
    expect(out).not.toContain("uses: actions/download-artifact@v4");
    expect(out).not.toContain("needs: build");
  });

  it.each(LANGUAGES)(
    "CD mode for %s wires upload/download-artifact named drop with a needs:build chain",
    (language) => {
      const out = buildPipelineFile({
        platform: "github",
        language,
        mode: "cd",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("uses: actions/upload-artifact@v4");
      expect(out).toContain("uses: actions/download-artifact@v4");
      // The drop artifact name must match between upload (build job) and
      // download (test job) — that's how the artifact is handed off.
      expect(out).toMatch(/name:\s+drop\b/);
      expect(out).toContain("path: drop/");
      expect(out).toContain("needs: build");
      expect(out).toContain("working-directory: drop");
    },
  );

  it.each(LANGUAGES)("uses the right setup-* action per language", (language) => {
    const ciOut = buildPipelineFile({
      platform: "github",
      language,
      mode: "ci",
      solutionName: SOLUTION_NAME,
    });
    const expectedAction =
      language === "csharp"
        ? "actions/setup-dotnet@v4"
        : language === "python"
          ? "actions/setup-python@v5"
          : language === "nodejs"
            ? "actions/setup-node@v4"
            : "actions/setup-java@v4";
    expect(ciOut).toContain(`uses: ${expectedAction}`);
  });
});

describe("Jenkins", () => {
  it.each(LANGUAGES)(
    "CI mode for %s emits declarative pipeline syntax without stash",
    (language) => {
      const out = buildPipelineFile({
        platform: "jenkins",
        language,
        mode: "ci",
        solutionName: SOLUTION_NAME,
      });
      expect(out.startsWith("pipeline {")).toBe(true);
      expect(out).toContain("agent any");
      expect(out).toContain("stages {");
      expect(out).toContain("steps {");
      expect(out).toContain("checkout scm");
      expect(out).toContain("archiveArtifacts");
      expect(out).not.toContain("stash ");
      expect(out).not.toContain("unstash ");
    },
  );

  it.each(LANGUAGES)(
    "CD mode for %s uses stash + unstash to hand the drop between stages",
    (language) => {
      const out = buildPipelineFile({
        platform: "jenkins",
        language,
        mode: "cd",
        solutionName: SOLUTION_NAME,
      });
      expect(out.startsWith("pipeline {")).toBe(true);
      expect(out).toMatch(/stash name: 'drop'/);
      expect(out).toMatch(/unstash 'drop'/);
      expect(out).toContain("dir('drop')");
      // Build stage clears the workspace before unstashing so the test
      // stage runs against the published drop only.
      expect(out).toContain("deleteDir()");
    },
  );
});

describe("GitLab CI/CD", () => {
  it.each(LANGUAGES)(
    "CI mode for %s declares a single stage with artifacts:paths and no dependencies:",
    (language) => {
      const out = buildPipelineFile({
        platform: "gitlab",
        language,
        mode: "ci",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("stages:\n  - test");
      expect(out).toContain("artifacts:");
      expect(out).toContain("paths:");
      // Single-stage CI doesn't pull anything from a previous stage.
      expect(out).not.toContain("dependencies:");
    },
  );

  it.each(LANGUAGES)(
    "CD mode for %s wires artifacts:paths in build and dependencies: in test",
    (language) => {
      const out = buildPipelineFile({
        platform: "gitlab",
        language,
        mode: "cd",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("stages:\n  - build\n  - test");
      // Build publishes the drop dir.
      expect(out).toMatch(/build:[\s\S]+artifacts:[\s\S]+paths:[\s\S]+- drop\//);
      // Test depends on build to receive the drop.
      expect(out).toMatch(/test:[\s\S]+dependencies:\n\s+- build/);
      // Subsequent test commands run from inside the drop dir.
      expect(out).toContain("- cd drop");
    },
  );
});

describe("Azure Pipelines", () => {
  it.each(LANGUAGES)(
    "CI mode for %s publishes artifacts via PublishPipelineArtifact@1",
    (language) => {
      const out = buildPipelineFile({
        platform: "azure",
        language,
        mode: "ci",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("PublishPipelineArtifact@1");
      // No download in CI — there's nothing to pull from a prior stage.
      expect(out).not.toContain("DownloadPipelineArtifact@2");
    },
  );

  it.each(LANGUAGES)(
    "CD mode for %s uses Publish/Download PipelineArtifact named drop across stages",
    (language) => {
      const out = buildPipelineFile({
        platform: "azure",
        language,
        mode: "cd",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("PublishPipelineArtifact@1");
      expect(out).toContain("DownloadPipelineArtifact@2");
      // The artifact name must match across stages so the test stage
      // actually picks up what build published.
      expect(out).toMatch(/artifactName:\s+drop\b/);
      expect(out).toMatch(/artifact:\s+drop\b/);
      // CD splits build and DeployAndTest and gates the latter on the
      // former so the test stage only runs after a successful build.
      expect(out).toContain("- stage: Build");
      expect(out).toContain("- stage: DeployAndTest");
      expect(out).toContain("dependsOn: Build");
    },
  );
});

describe("CircleCI", () => {
  it.each(LANGUAGES)(
    "CI mode for %s uses a single workspace job and no persist_to_workspace",
    (language) => {
      const out = buildPipelineFile({
        platform: "circleci",
        language,
        mode: "ci",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("version: 2.1");
      expect(out).toContain("store_artifacts:");
      expect(out).not.toContain("persist_to_workspace");
      expect(out).not.toContain("attach_workspace");
    },
  );

  it.each(LANGUAGES)(
    "CD mode for %s wires persist_to_workspace + attach_workspace between jobs",
    (language) => {
      const out = buildPipelineFile({
        platform: "circleci",
        language,
        mode: "cd",
        solutionName: SOLUTION_NAME,
      });
      expect(out).toContain("persist_to_workspace:");
      expect(out).toContain("attach_workspace:");
      // Build job persists the drop dir; test job attaches the same root
      // and runs from within drop/.
      expect(out).toMatch(/persist_to_workspace:[\s\S]+paths:\n\s+- drop/);
      expect(out).toMatch(/attach_workspace:\n\s+at:\s+~\/project/);
      expect(out).toContain("working_directory: ~/project/drop");
      // The workflow gates test on build so the workspace is populated
      // before the test job starts.
      expect(out).toMatch(/test:\n\s+requires:\n\s+- build/);
    },
  );
});

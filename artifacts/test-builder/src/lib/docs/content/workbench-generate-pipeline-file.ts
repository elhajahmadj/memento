import type { DocsSectionContent } from "../content";

export const sections: DocsSectionContent[] = [
  {
    sectionId: "workbench-generate-pipeline-file",
    heading: "Workbench — Generate Pipeline File",
    intro:
      "The 'Generate Pipeline File' item in the Workbench toolbar's Actions menu (immediately to the left of Help) writes a ready-to-commit CI/CD pipeline file into your project root, wired up to the same test runner the project was scaffolded for. Use it once you have a green local test run and want to put the project under continuous testing without hand-writing YAML for each provider.",
    walkthrough: [
      "Open a project so the Workbench toolbar is visible (the menu only appears when a project is loaded).",
      "Open the 'Actions' dropdown in the top-right toolbar (just to the left of Help) and pick 'Generate Pipeline File' to open the wizard.",
      "Step 1 — Pick a CI/CD platform: GitHub Actions, Jenkins, GitLab CI/CD, Azure Pipelines, or CircleCI. Jenkins is the only target that emits a Jenkinsfile (declarative pipeline syntax); the other four emit YAML.",
      "Step 2 — Pick where the Playwright tests should run: 'Run tests in CI' (single-job pipeline that runs the tests directly on push and pull requests) or 'Run tests in CD' (two-stage pipeline that publishes the project as a deployable 'drop' and then pulls it down to run the tests against that drop).",
      "Click 'Generate YAML' (or 'Generate Jenkinsfile' for Jenkins). The file is written into the project root at the platform's conventional path; refresh the file tree to see it.",
      "If a pipeline file is already at that path, you'll be asked whether to overwrite it. Cancel keeps the existing file untouched.",
      "Commit the generated file the way you would any other source file (admins save directly; users go through the SDET approval flow).",
    ],
    fields: [
      {
        name: "GitHub Actions",
        description:
          "Writes `.github/workflows/playwright.yml`. Triggers on push and pull_request to `main`. CD mode splits into a `build` job that uploads a `drop` artifact and a `test` job (`needs: build`) that downloads it and runs the tests from inside `drop/`.",
      },
      {
        name: "Jenkins",
        description:
          "Writes `Jenkinsfile` at the project root in declarative pipeline syntax (not YAML). Uses `agent any`; you'll need to make sure the agent provides the matching toolchain (.NET 8 SDK, Python 3.12, Node.js 20, or JDK 21 + Maven). CD mode `stash`es the drop in the build stage and `unstash`es it in the deploy/test stage.",
      },
      {
        name: "GitLab CI/CD",
        description:
          "Writes `.gitlab-ci.yml`. Runs on pushes to `main` and on merge requests, using the appropriate Microsoft Playwright Docker image per language. CD mode publishes `drop/` via `artifacts:paths` from the `build` job and the `test` job pulls it down with `dependencies:` and `cd drop`.",
      },
      {
        name: "Azure Pipelines",
        description:
          "Writes `azure-pipelines.yml`. Triggers on `main` (push and PR), runs on `ubuntu-latest`. CD mode emits two stages — `Build` (publishes the drop with `PublishPipelineArtifact@1`) and `DeployAndTest` (downloads the drop and runs the tests from inside it).",
      },
      {
        name: "CircleCI",
        description:
          "Writes `.circleci/config.yml`. Uses the appropriate `docker:` image per language (with Maven / npm caches). CD mode persists `drop/` to the workspace from the `build` job and the `test` job attaches it and runs the suite from inside `drop/`.",
      },
      {
        name: "CI vs CD mode",
        description:
          "CI = a single job that checks out the code, installs dependencies, and runs the tests on every push / PR. CD = two stages — first publish the project as a deployable 'drop' artifact, then download that drop and run the tests against it. CD mirrors how a real release pipeline behaves: you ship the artifact, then validate the artifact you shipped.",
      },
      {
        name: "Per-language test runner",
        description:
          "The runner wired into every generated file is whatever your project was scaffolded with: C# uses `dotnet test --logger trx`, Python uses `pytest` (after `pip install -r requirements.txt` and `playwright install --with-deps`), Node.js uses `npx playwright test` (after `npm ci` and `npx playwright install --with-deps`), and Java uses `mvn -B test` (Maven 3.9 + JDK 21).",
      },
      {
        name: "Overwrite confirmation",
        description:
          "If the platform's conventional file already exists in the project, the wizard pauses and asks before replacing it. Cancel leaves the file untouched.",
      },
    ],
  },
];

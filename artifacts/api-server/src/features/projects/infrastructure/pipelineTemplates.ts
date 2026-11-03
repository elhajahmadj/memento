import type { Language } from "@workspace/api-zod";

export type PipelinePlatform =
  | "github"
  | "jenkins"
  | "gitlab"
  | "azure"
  | "circleci";

export type PipelineMode = "ci" | "cd";

interface BuildArgs {
  platform: PipelinePlatform;
  language: Language;
  mode: PipelineMode;
  solutionName: string;
}

const PLATFORM_PATHS: Record<PipelinePlatform, string> = {
  github: ".github/workflows/playwright.yml",
  jenkins: "Jenkinsfile",
  gitlab: ".gitlab-ci.yml",
  azure: "azure-pipelines.yml",
  circleci: ".circleci/config.yml",
};

export function pipelineFilePath(platform: PipelinePlatform): string {
  return PLATFORM_PATHS[platform];
}

export function buildPipelineFile(args: BuildArgs): string {
  const lang = normalizeLanguage(args.language);
  switch (args.platform) {
    case "github":
      return githubActions(lang, args.mode);
    case "jenkins":
      return jenkinsfile(lang, args.mode);
    case "gitlab":
      return gitlabCi(lang, args.mode);
    case "azure":
      return azurePipelines(lang, args.mode);
    case "circleci":
      return circleCi(lang, args.mode);
  }
}

type Lang = "csharp" | "python" | "nodejs" | "java";

function normalizeLanguage(language: Language): Lang {
  return (language ?? "csharp") as Lang;
}

interface LangPlan {
  installSteps: string[];
  testSteps: string[];
  reportPaths: string[];
}

function shellPlan(lang: Lang): LangPlan {
  switch (lang) {
    case "csharp":
      return {
        installSteps: ["dotnet restore"],
        testSteps: [
          "dotnet test --logger trx --results-directory TestResults",
        ],
        reportPaths: ["TestResults", "playwright-report"],
      };
    case "python":
      return {
        installSteps: [
          "python -m pip install --upgrade pip",
          "pip install -r requirements.txt",
          "playwright install --with-deps",
        ],
        testSteps: ["pytest"],
        reportPaths: ["playwright-report"],
      };
    case "nodejs":
      return {
        installSteps: [
          "npm ci",
          "npx playwright install --with-deps",
        ],
        testSteps: ["npx playwright test"],
        reportPaths: ["playwright-report"],
      };
    case "java":
      return {
        installSteps: [],
        testSteps: ["mvn -B test"],
        reportPaths: ["target/surefire-reports", "playwright-report"],
      };
  }
}

function buildDropShell(lang: Lang): string[] {
  switch (lang) {
    case "csharp":
      return [
        "dotnet build -c Release",
        "mkdir -p drop",
        "rsync -a --exclude drop --exclude .git ./ drop/",
      ];
    case "python":
      return [
        "mkdir -p drop",
        "rsync -a --exclude drop --exclude .git --exclude __pycache__ --exclude .pytest_cache ./ drop/",
      ];
    case "nodejs":
      return [
        "mkdir -p drop",
        "rsync -a --exclude drop --exclude .git --exclude node_modules ./ drop/",
      ];
    case "java":
      return [
        "mvn -B -DskipTests package",
        "mkdir -p drop",
        "rsync -a --exclude drop --exclude .git ./ drop/",
      ];
  }
}

// =============================================================================
// GitHub Actions
// =============================================================================
function githubActions(lang: Lang, mode: PipelineMode): string {
  const setup = githubSetupBlock(lang);
  const plan = shellPlan(lang);
  const installLines = plan.installSteps.map((s) => `          ${s}`).join("\n");
  const testLines = plan.testSteps.map((s) => `          ${s}`).join("\n");
  const reportPaths = plan.reportPaths
    .map((p) => `            ${p}/`)
    .join("\n");
  const triggers = `on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
`;

  if (mode === "ci") {
    return `name: Playwright Tests
${triggers}
jobs:
  test:
    name: Run Playwright tests
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@v4

${setup}      - name: Install dependencies
        run: |
${installLines || "          : # no install step"}

      - name: Run Playwright tests
        run: |
${testLines}

      - name: Upload test reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-reports
          path: |
${reportPaths}
          if-no-files-found: ignore
`;
  }

  const buildSteps = githubBuildDrop(lang);
  const reportPathsDrop = plan.reportPaths
    .map((p) => `            drop/${p}/`)
    .join("\n");
  return `name: Playwright Tests (CD)
${triggers}
jobs:
  build:
    name: Build and publish drop
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@v4

${setup}${buildSteps}      - name: Upload drop artifact
        uses: actions/upload-artifact@v4
        with:
          name: drop
          path: drop/
          if-no-files-found: error

  test:
    name: Run Playwright tests against drop
    needs: build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: drop
    steps:
      - name: Download drop artifact
        uses: actions/download-artifact@v4
        with:
          name: drop
          path: drop/

${setup}      - name: Install test dependencies
        run: |
${installLines || "          : # no install step"}

      - name: Run Playwright tests
        run: |
${testLines}

      - name: Upload test reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-reports
          path: |
${reportPathsDrop}
          if-no-files-found: ignore
`;
}

function githubSetupBlock(lang: Lang): string {
  switch (lang) {
    case "csharp":
      return `      - name: Set up .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "8.0.x"

`;
    case "python":
      return `      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

`;
    case "nodejs":
      return `      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

`;
    case "java":
      return `      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
          cache: maven

`;
  }
}

function githubBuildDrop(lang: Lang): string {
  const cmds = buildDropShell(lang)
    .map((c) => `          ${c}`)
    .join("\n");
  return `      - name: Build drop
        run: |
${cmds}

`;
}

// =============================================================================
// Jenkins (declarative Jenkinsfile)
// =============================================================================
function jenkinsfile(lang: Lang, mode: PipelineMode): string {
  const plan = shellPlan(lang);
  const installCmds = plan.installSteps.length
    ? plan.installSteps.map((s) => `          sh '${s}'`).join("\n")
    : "          // no install step";
  const testCmds = plan.testSteps
    .map((s) => `          sh '${s}'`)
    .join("\n");
  const reportArchive = plan.reportPaths
    .map((p) => `'${p}/**/*'`)
    .join(", ");
  const reportArchiveDrop = plan.reportPaths
    .map((p) => `'drop/${p}/**/*'`)
    .join(", ");
  const agentSetup = jenkinsAgentSetup(lang);

  if (mode === "ci") {
    return `pipeline {
  agent any

  options {
    timestamps()
  }

${agentSetup}  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install dependencies') {
      steps {
${installCmds}
      }
    }

    stage('Run Playwright tests') {
      steps {
${testCmds}
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: ${reportArchive}, allowEmptyArchive: true, fingerprint: true
    }
  }
}
`;
  }

  // CD mode: build stage stashes the drop, deploy/test stage unstashes
  // it and runs install + tests from inside drop/ so the tests execute
  // against the published artifact.
  const buildDrop = jenkinsBuildDrop(lang);
  const installCmdsInDrop = plan.installSteps.length
    ? plan.installSteps
        .map((s) => `            sh '${s}'`)
        .join("\n")
    : "            // no install step";
  const testCmdsInDrop = plan.testSteps
    .map((s) => `            sh '${s}'`)
    .join("\n");

  return `pipeline {
  agent any

  options {
    timestamps()
  }

${agentSetup}  stages {
    stage('Build') {
      steps {
        checkout scm
${installCmds}
${buildDrop}
        stash name: 'drop', includes: 'drop/**/*'
      }
    }

    stage('Deploy and test') {
      steps {
        deleteDir()
        unstash 'drop'
        dir('drop') {
${installCmdsInDrop}
${testCmdsInDrop}
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: ${reportArchiveDrop}, allowEmptyArchive: true, fingerprint: true
    }
  }
}
`;
}

function jenkinsAgentSetup(lang: Lang): string {
  const toolchain =
    lang === "csharp"
      ? ".NET 8 SDK"
      : lang === "python"
        ? "Python 3.12"
        : lang === "nodejs"
          ? "Node.js 20"
          : "JDK 21 + Maven";
  return `  // Configure your agent to provide the matching toolchain (${toolchain}).\n`;
}

function jenkinsBuildDrop(lang: Lang): string {
  return buildDropShell(lang)
    .map((c) => `        sh '${c}'`)
    .join("\n");
}

// =============================================================================
// GitLab CI/CD
// =============================================================================
function gitlabCi(lang: Lang, mode: PipelineMode): string {
  const plan = shellPlan(lang);
  const image = gitlabImage(lang);
  const cache = gitlabCache(lang);
  const installLines = plan.installSteps.length
    ? plan.installSteps.map((s) => `    - ${s}`).join("\n")
    : "    - 'true' # no install step";
  const testLines = plan.testSteps.map((s) => `    - ${s}`).join("\n");
  const reportPaths = plan.reportPaths
    .map((p) => `      - ${p}/`)
    .join("\n");
  const reportPathsDrop = plan.reportPaths
    .map((p) => `      - drop/${p}/`)
    .join("\n");

  if (mode === "ci") {
    return `# GitLab CI/CD pipeline for Playwright tests
image: ${image}

${cache}stages:
  - test

playwright:
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
${installLines}
${testLines}
  artifacts:
    when: always
    expire_in: 1 week
    paths:
${reportPaths}
`;
  }

  // CD mode: build stage publishes a drop/ directory via artifacts:paths;
  // the test stage uses dependencies: to pull it down and runs every
  // command from inside drop/ so the tests execute against the artifact.
  const buildDrop = gitlabBuildDrop(lang);
  return `# GitLab CI/CD pipeline (build + deploy/test) for Playwright tests
image: ${image}

${cache}stages:
  - build
  - test

build:
  stage: build
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
${installLines}
${buildDrop}
  artifacts:
    name: drop
    expire_in: 1 week
    paths:
      - drop/

test:
  stage: test
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  dependencies:
    - build
  before_script:
    - cd drop
  script:
${installLines}
${testLines}
  artifacts:
    when: always
    expire_in: 1 week
    paths:
${reportPathsDrop}
`;
}

function gitlabImage(lang: Lang): string {
  switch (lang) {
    case "csharp":
      return "mcr.microsoft.com/dotnet/sdk:8.0";
    case "python":
      return "mcr.microsoft.com/playwright/python:v1.47.0-jammy";
    case "nodejs":
      return "mcr.microsoft.com/playwright:v1.47.0-jammy";
    case "java":
      return "maven:3.9-eclipse-temurin-21";
  }
}

function gitlabCache(lang: Lang): string {
  switch (lang) {
    case "nodejs":
      return `cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/

`;
    case "java":
      return `cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - .m2/repository/

variables:
  MAVEN_OPTS: "-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository"

`;
    default:
      return "";
  }
}

function gitlabBuildDrop(lang: Lang): string {
  return buildDropShell(lang)
    .map((c) => `    - ${c}`)
    .join("\n");
}

// =============================================================================
// Azure Pipelines
// =============================================================================
function azurePipelines(lang: Lang, mode: PipelineMode): string {
  const plan = shellPlan(lang);
  const setupTask = azureSetupTask(lang);
  const installLines = plan.installSteps.length
    ? plan.installSteps.map((s) => `      ${s}`).join("\n")
    : "      : # no install step";
  const testLines = plan.testSteps.map((s) => `      ${s}`).join("\n");
  const triggers = `trigger:
  branches:
    include:
      - main
pr:
  branches:
    include:
      - main
`;

  if (mode === "ci") {
    return `# Azure Pipelines for Playwright tests
${triggers}
pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self

${setupTask}  - script: |
${installLines}
    displayName: Install dependencies

  - script: |
${testLines}
    displayName: Run Playwright tests

  - task: PublishPipelineArtifact@1
    displayName: Publish test reports
    condition: always()
    inputs:
      targetPath: $(System.DefaultWorkingDirectory)
      artifactName: playwright-reports
`;
  }

  const buildDropSteps = azureBuildDropSteps(lang);
  return `# Azure Pipelines (build + deploy/test) for Playwright tests
${triggers}
stages:
  - stage: Build
    jobs:
      - job: build
        pool:
          vmImage: ubuntu-latest
        steps:
          - checkout: self

${indent(setupTask, 4)}${indent(buildDropSteps, 4)}          - task: PublishPipelineArtifact@1
            displayName: Publish drop
            inputs:
              targetPath: $(System.DefaultWorkingDirectory)/drop
              artifactName: drop

  - stage: DeployAndTest
    dependsOn: Build
    jobs:
      - job: test
        pool:
          vmImage: ubuntu-latest
        steps:
          - checkout: none

${indent(setupTask, 4)}          - task: DownloadPipelineArtifact@2
            displayName: Download drop
            inputs:
              artifact: drop
              path: $(System.DefaultWorkingDirectory)/drop

          - script: |
${indent(installLines, 4)}
            displayName: Install test dependencies
            workingDirectory: $(System.DefaultWorkingDirectory)/drop

          - script: |
${indent(testLines, 4)}
            displayName: Run Playwright tests
            workingDirectory: $(System.DefaultWorkingDirectory)/drop

          - task: PublishPipelineArtifact@1
            displayName: Publish test reports
            condition: always()
            inputs:
              targetPath: $(System.DefaultWorkingDirectory)/drop
              artifactName: playwright-reports
`;
}

function azureSetupTask(lang: Lang): string {
  switch (lang) {
    case "csharp":
      return `  - task: UseDotNet@2
    inputs:
      packageType: sdk
      version: "8.0.x"

`;
    case "python":
      return `  - task: UsePythonVersion@0
    inputs:
      versionSpec: "3.12"

`;
    case "nodejs":
      return `  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"

`;
    case "java":
      return `  - task: JavaToolInstaller@0
    inputs:
      versionSpec: "21"
      jdkArchitectureOption: x64
      jdkSourceOption: PreInstalled

  - task: Cache@2
    displayName: Cache Maven repository
    inputs:
      key: 'maven | "$(Agent.OS)" | **/pom.xml'
      restoreKeys: |
        maven | "$(Agent.OS)"
        maven
      path: $(HOME)/.m2/repository

`;
  }
}

function azureBuildDropSteps(lang: Lang): string {
  const cmds = buildDropShell(lang)
    .map((c) => `      ${c}`)
    .join("\n");
  return `  - script: |
${cmds}
    displayName: Build drop

`;
}

function indent(block: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return block
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

// =============================================================================
// CircleCI
// =============================================================================
function circleCi(lang: Lang, mode: PipelineMode): string {
  const plan = shellPlan(lang);
  const dockerImage = circleDockerImage(lang);
  const installLines = plan.installSteps.length
    ? plan.installSteps.map((s) => `            ${s}`).join("\n")
    : "            : # no install step";
  const testLines = plan.testSteps
    .map((s) => `            ${s}`)
    .join("\n");
  const reportArtifactsCi = plan.reportPaths
    .map(
      (p) => `      - store_artifacts:
          path: ${p}
          destination: ${p}`,
    )
    .join("\n");
  const reportArtifactsCd = plan.reportPaths
    .map(
      (p) => `      - store_artifacts:
          path: drop/${p}
          destination: ${p}`,
    )
    .join("\n");
  const cacheRestore = circleCacheRestore(lang);
  const cacheSave = circleCacheSave(lang);

  if (mode === "ci") {
    return `version: 2.1

jobs:
  test:
    docker:
      - image: ${dockerImage}
    steps:
      - checkout
${cacheRestore}      - run:
          name: Install dependencies
          command: |
${installLines}
${cacheSave}      - run:
          name: Run Playwright tests
          command: |
${testLines}
${reportArtifactsCi}

workflows:
  test:
    jobs:
      - test
`;
  }

  const buildDrop = circleBuildDrop(lang);
  return `version: 2.1

jobs:
  build:
    docker:
      - image: ${dockerImage}
    steps:
      - checkout
${cacheRestore}      - run:
          name: Install build dependencies
          command: |
${installLines}
${cacheSave}      - run:
          name: Build drop
          command: |
${buildDrop}
      - persist_to_workspace:
          root: .
          paths:
            - drop

  test:
    docker:
      - image: ${dockerImage}
    working_directory: ~/project/drop
    steps:
      - attach_workspace:
          at: ~/project
${cacheRestore}      - run:
          name: Install test dependencies
          command: |
${installLines}
${cacheSave}      - run:
          name: Run Playwright tests
          command: |
${testLines}
${reportArtifactsCd}

workflows:
  build_and_test:
    jobs:
      - build
      - test:
          requires:
            - build
`;
}

function circleCacheRestore(lang: Lang): string {
  switch (lang) {
    case "java":
      return `      - restore_cache:
          keys:
            - maven-{{ checksum "pom.xml" }}
            - maven-
`;
    case "nodejs":
      return `      - restore_cache:
          keys:
            - node-{{ checksum "package-lock.json" }}
            - node-
`;
    default:
      return "";
  }
}

function circleCacheSave(lang: Lang): string {
  switch (lang) {
    case "java":
      return `      - save_cache:
          key: maven-{{ checksum "pom.xml" }}
          paths:
            - ~/.m2/repository
`;
    case "nodejs":
      return `      - save_cache:
          key: node-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
`;
    default:
      return "";
  }
}

function circleDockerImage(lang: Lang): string {
  switch (lang) {
    case "csharp":
      return "mcr.microsoft.com/dotnet/sdk:8.0";
    case "python":
      return "mcr.microsoft.com/playwright/python:v1.47.0-jammy";
    case "nodejs":
      return "mcr.microsoft.com/playwright:v1.47.0-jammy";
    case "java":
      return "cimg/openjdk:21.0";
  }
}

function circleBuildDrop(lang: Lang): string {
  return buildDropShell(lang)
    .map((c) => `            ${c}`)
    .join("\n");
}

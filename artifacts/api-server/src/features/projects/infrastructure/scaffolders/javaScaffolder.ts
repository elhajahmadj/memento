import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";
import { applyTokens } from "@/features/codegen/infrastructure/templates";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import type { Architecture } from "@/features/architectures/infrastructure/architectureService";
import { JAVA_PROJECT_FILE } from "../../domain/paths";
import {
  javaPackageName,
  javaTestsModuleName,
} from "../../domain/naming";
import type { Project, ProjectMarker } from "../../domain/types";
import { writeFolderRecursive, writeProjectMarker } from "./shared";

const JAVA_PARENT_POM_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>{{Package}}</groupId>
    <artifactId>{{Solution}}</artifactId>
    <version>0.1.0</version>
    <packaging>pom</packaging>
    <modules>
{{ModuleEntries}}
    </modules>
    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <playwright.version>1.55.0</playwright.version>
        <junit.version>5.11.0</junit.version>
        <dotenv.version>3.0.2</dotenv.version>
        <surefire.version>3.2.5</surefire.version>
    </properties>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>com.microsoft.playwright</groupId>
                <artifactId>playwright</artifactId>
                <version>\${playwright.version}</version>
            </dependency>
            <dependency>
                <groupId>org.junit.jupiter</groupId>
                <artifactId>junit-jupiter</artifactId>
                <version>\${junit.version}</version>
                <scope>test</scope>
            </dependency>
            <dependency>
                <groupId>org.junit.jupiter</groupId>
                <artifactId>junit-jupiter-api</artifactId>
                <version>\${junit.version}</version>
            </dependency>
            <dependency>
                <groupId>io.github.cdimascio</groupId>
                <artifactId>dotenv-java</artifactId>
                <version>\${dotenv.version}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-surefire-plugin</artifactId>
                    <version>\${surefire.version}</version>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
`;

function generateJavaParentPomContent(
  solutionName: string,
  arch: Architecture,
): string {
  const moduleEntries = arch.projects
    .map((p) => `        <module>${solutionName}${p.nameSuffix}</module>`)
    .join("\n");
  const pkg = javaPackageName(solutionName);
  return JAVA_PARENT_POM_TEMPLATE.replace("{{Package}}", pkg)
    .replace("{{Solution}}", solutionName)
    .replace("{{ModuleEntries}}", moduleEntries);
}

/**
 * Scaffold a Java Maven multi-module project. Each ArchProject becomes
 * a sibling module dir under the workspace root, and a parent pom.xml
 * (the returned slnPath) ties them together. `.vscode/` lands at the
 * workspace root alongside the parent pom rather than in any one module.
 */
export async function scaffoldJavaFromArchitecture(
  validated: Architecture,
  solutionName: string,
  _namespace: string,
): Promise<Project> {
  const pkg = javaPackageName(solutionName);
  const vars = {
    namespace: pkg,
    solution: solutionName,
    package: pkg,
    testPackage: pkg,
  };

  await fs.mkdir(recorderConfig.workspaceDir, { recursive: true });
  const rootPath = path.join(recorderConfig.workspaceDir, solutionName);
  await fs.mkdir(rootPath, { recursive: true });

  const slnPath = path.join(rootPath, JAVA_PROJECT_FILE);
  await fs.writeFile(
    slnPath,
    generateJavaParentPomContent(solutionName, validated),
  );

  let testsModuleName = javaTestsModuleName(solutionName);
  for (const archProject of validated.projects) {
    const moduleName = `${solutionName}${archProject.nameSuffix}`;
    const moduleDir = safeJoin(rootPath, moduleName);
    await fs.mkdir(moduleDir, { recursive: true });

    if (archProject.isTestsProject) {
      testsModuleName = moduleName;
    }

    for (const f of archProject.files) {
      const fileName = applyTokens(f.name, vars);
      await fs.writeFile(
        safeJoin(moduleDir, fileName),
        applyTokens(f.content, vars),
      );
    }
    for (const folder of archProject.folders) {
      await writeFolderRecursive(rootPath, moduleDir, folder, vars);
    }
  }

  await writeVscodeFiles(rootPath, testsModuleName);

  const marker: ProjectMarker = {
    architectureId: validated.id,
    testProjectName: testsModuleName,
    namespace: pkg,
    solutionName,
    language: "java",
  };
  await writeProjectMarker(rootPath, marker);

  return {
    solutionName,
    testProjectName: testsModuleName,
    namespace: pkg,
    rootPath,
    slnPath,
    language: "java",
    solutionType: "playwright",
  };
}

async function writeVscodeFiles(
  rootPath: string,
  testsModuleName: string,
): Promise<void> {
  // Top-level `.vscode/` IDE config (settings + launch + extensions).
  // Generated synthetically here rather than baked into the architecture
  // because it lives at the workspace root, not inside any one module.
  const vscodeDir = safeJoin(rootPath, ".vscode");
  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(
    safeJoin(vscodeDir, "settings.json"),
    `${JSON.stringify(
      {
        "java.configuration.updateBuildConfiguration": "automatic",
        "java.compile.nullAnalysis.mode": "automatic",
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    safeJoin(vscodeDir, "launch.json"),
    `${JSON.stringify(
      {
        version: "0.2.0",
        configurations: [
          {
            type: "java",
            name: "Run JUnit Tests",
            request: "launch",
            mainClass: "",
            projectName: testsModuleName,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    safeJoin(vscodeDir, "extensions.json"),
    `${JSON.stringify(
      {
        recommendations: [
          "vscjava.vscode-java-pack",
          "ms-playwright.playwright",
        ],
      },
      null,
      2,
    )}\n`,
  );
}

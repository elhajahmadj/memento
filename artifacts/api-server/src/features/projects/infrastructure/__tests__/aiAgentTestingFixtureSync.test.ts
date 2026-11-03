import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject } from "../projectService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..", "..", "..");
const COMMITTED_FIXTURE = path.join(REPO_ROOT, "workspace", "AiAgentTesting");

const SOLUTION_NAME = "AiAgentTesting";
const NAMESPACE = "AiAgentTesting";

const CURATED_FILES: ReadonlySet<string> = new Set([
  "AiAgentTesting.Tests/Tests/SeededLoginTests.cs",
]);

const CURATED_GITKEEPS_REPLACED: ReadonlySet<string> = new Set(
  [...CURATED_FILES].map((p) => `${path.posix.dirname(p)}/.gitkeep`),
);

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const relChild = rel ? path.posix.join(rel, e.name) : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await recurse(abs, relChild);
      } else if (e.isFile()) {
        out.push(relChild);
      }
    }
  }
  await recurse(root, "");
  out.sort();
  return out;
}

describe("seeded AiAgentTesting fixture stays in sync with the scaffolder", () => {
  let tmp: string;
  let scaffoldRoot: string;
  const originalWorkspace = recorderConfig.workspaceDir;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-agent-fixture-"));
    recorderConfig.workspaceDir = tmp;
    const project = await createProject({
      solutionName: SOLUTION_NAME,
      namespace: NAMESPACE,
    });
    scaffoldRoot = project.rootPath;
  });

  afterAll(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("produces the same set of files as the committed fixture", async () => {
    const committed = (await walk(COMMITTED_FIXTURE)).filter(
      (p) => !CURATED_FILES.has(p),
    );
    const scaffolded = (await walk(scaffoldRoot)).filter(
      (p) => !CURATED_GITKEEPS_REPLACED.has(p),
    );
    expect(scaffolded).toEqual(committed);
  });

  it("produces byte-identical file contents for every non-curated file", async () => {
    const committed = (await walk(COMMITTED_FIXTURE)).filter(
      (p) => !CURATED_FILES.has(p),
    );
    const mismatches: string[] = [];
    for (const rel of committed) {
      const a = await fs.readFile(path.join(COMMITTED_FIXTURE, rel), "utf8");
      const b = await fs.readFile(path.join(scaffoldRoot, rel), "utf8");
      if (a !== b) {
        mismatches.push(rel);
      }
    }
    expect(
      mismatches,
      `Committed AiAgentTesting fixture has drifted from the scaffolder for these files. ` +
        `Re-run POST /api/projects (csharp/playwright, solutionName=AiAgentTesting, namespace=AiAgentTesting) ` +
        `and replace the committed copy under workspace/AiAgentTesting/, or update the scaffolder if the drift is intentional. ` +
        `Drifted files: ${mismatches.join(", ")}`,
    ).toEqual([]);
  });
});

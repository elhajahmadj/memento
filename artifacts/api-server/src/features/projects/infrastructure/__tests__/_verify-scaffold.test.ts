import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { createProject } from "../projectService.js";

describe("verify Constants/TestCategories folders", () => {
  beforeEach(async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "verify-"));
    recorderConfig.workspaceDir = tmp;
  });
  it("creates Constants and TestCategories folders for default C# project", async () => {
    const p = await createProject({ solutionName: "Foo", namespace: "Acme" });
    const tests = path.join(p.rootPath, "Foo.Tests");
    const entries = await fs.readdir(tests);
    console.log("Foo.Tests contents:", entries);
    expect(entries).toContain("Constants");
    expect(entries).toContain("TestCategories");
  });
});

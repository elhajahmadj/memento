import { describe, it, expect } from "vitest";
import {
  ArchitectureSchema,
  architecturesComposition,
  type Architecture,
} from "@/features/architectures/infrastructure/architectureService";

async function upsertArchitecture(arch: Architecture): Promise<Architecture> {
  const r = await architecturesComposition.upsert.execute(arch);
  if (r.kind === "err") throw new Error(r.error.message);
  return r.value;
}
async function deleteArchitecture(id: string): Promise<void> {
  const r = await architecturesComposition.delete.execute(id);
  if (r.kind === "err") throw new Error(r.error.message);
}
async function listArchitectures(): Promise<Architecture[]> {
  const r = await architecturesComposition.list.execute();
  if (r.kind === "err") throw new Error(r.error.message);
  return r.value;
}
async function getArchitecture(id: string): Promise<Architecture | null> {
  const r = await architecturesComposition.get.execute(id);
  if (r.kind === "ok") return r.value;
  if (r.error.kind === "not_found") return null;
  throw new Error(r.error.message);
}

function baseArch(overrides: Partial<Architecture> = {}): Architecture {
  return {
    id: "arch-1",
    name: "MyArch",
    isBuiltIn: false,
    projects: [
      {
        id: "p1",
        nameSuffix: ".Tests",
        isTestsProject: true,
        slnGuid: "{00000000-0000-0000-0000-000000000001}",
        files: [],
        folders: [],
      },
    ],
    ...overrides,
  };
}

describe("ArchitectureSchema path-segment validation", () => {
  it("accepts a well-formed architecture with nested folders", () => {
    const arch = baseArch({
      projects: [
        {
          id: "p1",
          nameSuffix: ".Tests",
          isTestsProject: true,
          slnGuid: "{00000000-0000-0000-0000-000000000001}",
          files: [{ name: "appsettings.json", content: "{}" }],
          folders: [
            {
              name: "Tests",
              files: [{ name: "Smoke.cs", content: "// hi" }],
              folders: [
                { name: "Nested", files: [], folders: [] },
              ],
            },
          ],
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(true);
  });

  it("rejects file names containing forward slashes", () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          files: [{ name: "../escape.cs", content: "x" }],
        },
      ],
    });
    const r = ArchitectureSchema.safeParse(arch);
    expect(r.success).toBe(false);
  });

  it("rejects folder names containing backslashes", () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          folders: [{ name: "a\\b", files: [], folders: [] }],
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(false);
  });

  it('rejects ".." as a folder name', () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          folders: [{ name: "..", files: [], folders: [] }],
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(false);
  });

  it("rejects nested folder traversal deep in the tree", () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          folders: [
            {
              name: "ok",
              files: [],
              folders: [
                {
                  name: "alsoOk",
                  files: [{ name: "/etc/passwd", content: "x" }],
                  folders: [],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(false);
  });

  it("rejects project name suffix containing a path separator", () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          nameSuffix: "../Evil",
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(false);
  });

  it("rejects empty file name", () => {
    const arch = baseArch({
      projects: [
        {
          ...baseArch().projects[0]!,
          files: [{ name: "", content: "x" }],
        },
      ],
    });
    expect(ArchitectureSchema.safeParse(arch).success).toBe(false);
  });
});

describe("Architecture id path-traversal hardening", () => {
  // Empty id is allowed on upsert (server generates a UUID), so it is
  // tested separately for delete only.
  const malicious = [
    "../escape",
    "..",
    "/abs/path",
    "a/b",
    "a\\b",
    "name with space",
    "a".repeat(65),
  ];

  for (const id of malicious) {
    it(`upsertArchitecture rejects unsafe id "${id}"`, async () => {
      const arch: Architecture = {
        id,
        name: "x",
        isBuiltIn: false,
        projects: [
          {
            id: "p",
            nameSuffix: ".Tests",
            isTestsProject: true,
            slnGuid: "{0}",
            files: [],
            folders: [],
          },
        ],
      };
      await expect(upsertArchitecture(arch)).rejects.toThrow();
    });

    it(`deleteArchitecture rejects unsafe id "${id}"`, async () => {
      await expect(deleteArchitecture(id)).rejects.toThrow();
    });
  }
});

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  API_DEFAULT_CSHARP_ARCHITECTURE_ID,
  API_DEFAULT_JAVA_ARCHITECTURE_ID,
  API_DEFAULT_NODEJS_ARCHITECTURE_ID,
  API_DEFAULT_PYTHON_ARCHITECTURE_ID,
  architectureSolutionType,
  isBuiltInApiArchitectureId,
} from "@/features/architectures/infrastructure/architectureService";
import { afterEach, beforeEach } from "vitest";

describe("Architecture solutionType (Option A: custom API architectures)", () => {
  let tmp: string;
  let originalWorkspace: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-arch-st-"));
    originalWorkspace = recorderConfig.workspaceDir;
    recorderConfig.workspaceDir = tmp;
  });
  afterEach(async () => {
    recorderConfig.workspaceDir = originalWorkspace;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("registers a built-in API marker architecture per language with empty projects", async () => {
    const list = await listArchitectures();
    for (const id of [
      API_DEFAULT_CSHARP_ARCHITECTURE_ID,
      API_DEFAULT_PYTHON_ARCHITECTURE_ID,
      API_DEFAULT_NODEJS_ARCHITECTURE_ID,
      API_DEFAULT_JAVA_ARCHITECTURE_ID,
    ]) {
      const found = list.find((a) => a.id === id);
      expect(found, `missing built-in ${id}`).toBeDefined();
      expect(found?.isBuiltIn).toBe(true);
      expect(architectureSolutionType(found!)).toBe("api");
      // Empty projects: scaffolding for built-in API archs is delegated
      // to the per-language hardcoded scaffolders.
      expect(found?.projects).toEqual([]);
    }
  });

  it("recognises legacy and per-language built-in api ids via isBuiltInApiArchitectureId", () => {
    expect(isBuiltInApiArchitectureId(API_DEFAULT_CSHARP_ARCHITECTURE_ID)).toBe(true);
    expect(isBuiltInApiArchitectureId(API_DEFAULT_PYTHON_ARCHITECTURE_ID)).toBe(true);
    expect(isBuiltInApiArchitectureId(API_DEFAULT_NODEJS_ARCHITECTURE_ID)).toBe(true);
    expect(isBuiltInApiArchitectureId(API_DEFAULT_JAVA_ARCHITECTURE_ID)).toBe(true);
    // Legacy single id from before the per-language split.
    expect(isBuiltInApiArchitectureId("api-default")).toBe(true);
    expect(isBuiltInApiArchitectureId("custom-x")).toBe(false);
    expect(isBuiltInApiArchitectureId("default")).toBe(false);
  });

  it("upsertArchitecture round-trips solutionType and defaults to playwright when omitted", async () => {
    const apiArch: Architecture = {
      id: "my-api-arch",
      name: "My API",
      isBuiltIn: false,
      language: "csharp",
      solutionType: "api",
      projects: [
        {
          id: "p",
          nameSuffix: ".ApiTests",
          isTestsProject: true,
          slnGuid: "{00000000-0000-0000-0000-000000000099}",
          files: [],
          folders: [],
        },
      ],
    };
    const saved = await upsertArchitecture(apiArch);
    expect(saved.solutionType).toBe("api");

    const fetched = await getArchitecture("my-api-arch");
    expect(fetched).not.toBeNull();
    expect(architectureSolutionType(fetched!)).toBe("api");

    // Legacy custom arch on disk without a solutionType field is treated
    // as "playwright" so existing JSON files keep working unchanged.
    const dir = path.join(recorderConfig.workspaceDir, ".architectures");
    await fs.mkdir(dir, { recursive: true });
    const legacy: Architecture = {
      id: "legacy-arch",
      name: "Legacy",
      isBuiltIn: false,
      language: "csharp",
      projects: apiArch.projects,
    };
    await fs.writeFile(
      path.join(dir, "legacy-arch.json"),
      JSON.stringify(legacy, null, 2),
    );
    const fetchedLegacy = await getArchitecture("legacy-arch");
    expect(fetchedLegacy).not.toBeNull();
    expect(architectureSolutionType(fetchedLegacy!)).toBe("playwright");
  });

  it("rejects upsert of any built-in API architecture id", async () => {
    for (const id of [
      API_DEFAULT_CSHARP_ARCHITECTURE_ID,
      API_DEFAULT_PYTHON_ARCHITECTURE_ID,
      API_DEFAULT_NODEJS_ARCHITECTURE_ID,
      API_DEFAULT_JAVA_ARCHITECTURE_ID,
    ]) {
      const arch: Architecture = {
        id,
        name: "Hijack",
        isBuiltIn: false,
        language: "csharp",
        solutionType: "api",
        projects: [
          {
            id: "p",
            nameSuffix: ".Tests",
            isTestsProject: true,
            slnGuid: "{0}",
            files: [],
            folders: [],
          },
        ],
      };
      await expect(upsertArchitecture(arch)).rejects.toThrow(/built-in/i);
    }
  });
});

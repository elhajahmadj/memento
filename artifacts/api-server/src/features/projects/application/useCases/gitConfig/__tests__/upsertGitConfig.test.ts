import { describe, expect, it, vi } from "vitest";
import type { ProjectGitConfig, RepoPat } from "@workspace/db";
import {
  upsertGitConfig,
  type UpsertGitConfigDeps,
} from "@/features/projects/application/useCases/gitConfig/upsertGitConfig";

function makeDeps(
  overrides: Partial<UpsertGitConfigDeps> = {},
): UpsertGitConfigDeps {
  return {
    loadExisting: vi.fn().mockResolvedValue(undefined),
    loadLinkedPat: vi.fn().mockResolvedValue(null),
    validateRepoUrl: (_p, raw) => raw,
    read: vi.fn().mockResolvedValue({
      provider: "azure_repos",
      repoUrl: "",
      branch: "main",
      patSetAt: null,
      patLastFour: null,
      repoPatId: null,
      repoPatName: null,
    }),
    insertRow: vi.fn().mockResolvedValue(undefined),
    updateRow: vi.fn().mockResolvedValue(undefined),
    encryptSecret: (s) => `enc(${s})`,
    getProjectSecretsKey: () => Buffer.alloc(32),
    ...overrides,
  };
}

describe("upsertGitConfig (port-mocked)", () => {
  it("requires a non-empty branch", async () => {
    await expect(
      upsertGitConfig(
        {
          projectName: "p",
          provider: "github",
          repoUrl: "https://github.com/o/r",
          branch: "   ",
          pat: "longenoughpat",
          repoPatId: null,
          updatedByUserId: "u",
        },
        makeDeps(),
      ),
    ).rejects.toThrow(/branch/i);
  });

  it("inserts an inline-PAT row with encrypted PAT + last-four when no row exists", async () => {
    const insertRow = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ insertRow });
    await upsertGitConfig(
      {
        projectName: "p1",
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "main",
        pat: "abcdefghLAST",
        repoPatId: null,
        updatedByUserId: "u",
      },
      deps,
    );
    expect(insertRow).toHaveBeenCalledTimes(1);
    const row = insertRow.mock.calls[0]![0];
    expect(row.provider).toBe("azure_repos");
    expect(row.patEncrypted).toBe("enc(abcdefghLAST)");
    expect(row.patLastFour).toBe("LAST");
    expect(row.repoPatId).toBeNull();
  });

  it("updates a row keeping the existing PAT when `pat: null` and the row was inline", async () => {
    const updateRow = vi.fn().mockResolvedValue(undefined);
    const existing: ProjectGitConfig = {
      projectName: "p1",
      provider: "azure_repos",
      repoUrl: "https://dev.azure.com/o/p/_git/r",
      branch: "main",
      patEncrypted: "enc(prior)",
      patLastFour: "rior",
      patSetAt: new Date(),
      repoPatId: null,
      updatedByUserId: "u",
      updatedAt: new Date(),
      createdAt: new Date(),
    } as unknown as ProjectGitConfig;
    const deps = makeDeps({
      loadExisting: vi.fn().mockResolvedValue(existing),
      updateRow,
    });
    await upsertGitConfig(
      {
        projectName: "p1",
        provider: "azure_repos",
        repoUrl: "https://dev.azure.com/o/p/_git/r",
        branch: "develop",
        pat: null,
        repoPatId: null,
        updatedByUserId: "u2",
      },
      deps,
    );
    expect(updateRow).toHaveBeenCalledTimes(1);
    const row = updateRow.mock.calls[0]![1];
    // PAT fields untouched.
    expect(row.patEncrypted).toBeUndefined();
    expect(row.patLastFour).toBeUndefined();
    expect(row.branch).toBe("develop");
  });

  it("rejects pat: null on a brand-new row", async () => {
    await expect(
      upsertGitConfig(
        {
          projectName: "p",
          provider: "github",
          repoUrl: "https://github.com/o/r",
          branch: "main",
          pat: null,
          repoPatId: null,
          updatedByUserId: "u",
        },
        makeDeps(),
      ),
    ).rejects.toThrow(/Personal Access Token/);
  });

  it("rejects existing_pat mode without repoPatId", async () => {
    await expect(
      upsertGitConfig(
        {
          projectName: "p",
          provider: "existing_pat",
          repoUrl: "https://github.com/o/r",
          branch: "main",
          pat: null,
          repoPatId: null,
          updatedByUserId: "u",
        },
        makeDeps(),
      ),
    ).rejects.toThrow(/Existing Repo PAT/);
  });

  it("existing_pat mode: persists the linked PAT's provider and repoPatId", async () => {
    const linked: RepoPat = {
      id: "linked-1",
      provider: "github",
      name: "shared",
      patEncrypted: "enc(x)",
      patLastFour: "xxxx",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as RepoPat;
    const insertRow = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      loadLinkedPat: vi.fn().mockResolvedValue(linked),
      insertRow,
    });
    await upsertGitConfig(
      {
        projectName: "p",
        provider: "existing_pat",
        repoUrl: "https://github.com/o/r",
        branch: "main",
        pat: null,
        repoPatId: "linked-1",
        updatedByUserId: "u",
      },
      deps,
    );
    const row = insertRow.mock.calls[0]![0];
    expect(row.provider).toBe("github");
    expect(row.repoPatId).toBe("linked-1");
    expect(row.patEncrypted).toBeNull();
  });

  it("rejects both an inline pat and a repoPatId", async () => {
    await expect(
      upsertGitConfig(
        {
          projectName: "p",
          provider: "existing_pat",
          repoUrl: "https://github.com/o/r",
          branch: "main",
          pat: "inline-WXYZ",
          repoPatId: "11111111-1111-1111-1111-111111111111",
          updatedByUserId: "u",
        },
        makeDeps(),
      ),
    ).rejects.toThrow(/both|one source/i);
  });
});

/**
 * Port-mocked tests for the architecture use cases. These exercise the
 * pure use-case logic without touching the filesystem.
 */
import { describe, expect, it } from "vitest";

import type { Architecture } from "../../../domain/types";
import type { ArchitectureRepository } from "../../../domain/ports/architectureRepository";
import { makeListArchitecturesUseCase } from "../listArchitectures";
import { makeGetArchitectureUseCase } from "../getArchitecture";
import { makeUpsertArchitectureUseCase } from "../upsertArchitecture";
import { makeDeleteArchitectureUseCase } from "../deleteArchitecture";
import { BUILTIN_ARCHITECTURES } from "../../../domain/builtIns";

class InMemoryRepo implements ArchitectureRepository {
  store = new Map<string, Architecture>();

  async list() {
    return Array.from(this.store.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
  async save(arch: Architecture) {
    this.store.set(arch.id, arch);
    return arch;
  }
  async delete(id: string) {
    this.store.delete(id);
  }
}

function customArch(over: Partial<Architecture> = {}): Architecture {
  return {
    id: "custom-1",
    name: "Custom",
    isBuiltIn: false,
    language: "csharp",
    projects: [
      {
        id: "p",
        nameSuffix: ".Tests",
        isTestsProject: true,
        slnGuid: "{00000000-0000-0000-0000-000000000001}",
        files: [],
        folders: [],
      },
    ],
    ...over,
  };
}

describe("listArchitectures use case", () => {
  it("returns built-ins followed by custom architectures", async () => {
    const repo = new InMemoryRepo();
    await repo.save(customArch({ id: "a", name: "Zeta" }));
    const result = await makeListArchitecturesUseCase(repo).execute();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.slice(0, BUILTIN_ARCHITECTURES.length)).toEqual(
      BUILTIN_ARCHITECTURES,
    );
    expect(result.value.at(-1)?.id).toBe("a");
  });

  it("returns an infrastructure error when the repository throws", async () => {
    const repo: ArchitectureRepository = {
      list: async () => {
        throw new Error("disk dead");
      },
      findById: async () => null,
      save: async (a) => a,
      delete: async () => {},
    };
    const result = await makeListArchitecturesUseCase(repo).execute();
    expect(result.kind).toBe("err");
    if (result.kind !== "err") return;
    expect(result.error.kind).toBe("infrastructure");
  });
});

describe("getArchitecture use case", () => {
  it("resolves built-in ids without touching the repository", async () => {
    let calls = 0;
    const repo: ArchitectureRepository = {
      list: async () => [],
      findById: async () => {
        calls++;
        return null;
      },
      save: async (a) => a,
      delete: async () => {},
    };
    const result = await makeGetArchitectureUseCase(repo).execute("default");
    expect(result.kind).toBe("ok");
    expect(calls).toBe(0);
  });

  it("returns not_found when the id is unknown", async () => {
    const repo = new InMemoryRepo();
    const result = await makeGetArchitectureUseCase(repo).execute("missing");
    expect(result.kind).toBe("err");
    if (result.kind !== "err") return;
    expect(result.error.kind).toBe("not_found");
  });

  it("returns the persisted custom architecture", async () => {
    const repo = new InMemoryRepo();
    await repo.save(customArch({ id: "x" }));
    const result = await makeGetArchitectureUseCase(repo).execute("x");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.id).toBe("x");
  });
});

describe("upsertArchitecture use case", () => {
  it("rejects built-in ids with a validation error", async () => {
    const repo = new InMemoryRepo();
    const result = await makeUpsertArchitectureUseCase(repo).execute(
      customArch({ id: "default" }),
    );
    expect(result.kind).toBe("err");
    if (result.kind !== "err") return;
    expect(result.error.kind).toBe("validation");
    expect(repo.store.size).toBe(0);
  });

  it("rejects structurally invalid architectures with a validation error", async () => {
    const repo = new InMemoryRepo();
    const result = await makeUpsertArchitectureUseCase(repo).execute(
      customArch({ projects: [] }),
    );
    expect(result.kind).toBe("err");
    if (result.kind !== "err") return;
    expect(result.error.kind).toBe("validation");
  });

  it("generates a fresh id when the caller supplies an empty one", async () => {
    const repo = new InMemoryRepo();
    const result = await makeUpsertArchitectureUseCase(repo).execute(
      customArch({ id: "" }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.id.length).toBeGreaterThan(0);
    expect(repo.store.has(result.value.id)).toBe(true);
  });

  it("persists the architecture through the port", async () => {
    const repo = new InMemoryRepo();
    const arch = customArch({ id: "saved", name: "Saved" });
    const result = await makeUpsertArchitectureUseCase(repo).execute(arch);
    expect(result.kind).toBe("ok");
    expect(repo.store.get("saved")?.name).toBe("Saved");
  });
});

describe("deleteArchitecture use case", () => {
  it("rejects built-in ids with a validation error", async () => {
    const repo = new InMemoryRepo();
    const result = await makeDeleteArchitectureUseCase(repo).execute("default");
    expect(result.kind).toBe("err");
    if (result.kind !== "err") return;
    expect(result.error.kind).toBe("validation");
  });

  it("removes a custom architecture through the port", async () => {
    const repo = new InMemoryRepo();
    await repo.save(customArch({ id: "doomed" }));
    const result = await makeDeleteArchitectureUseCase(repo).execute("doomed");
    expect(result.kind).toBe("ok");
    expect(repo.store.has("doomed")).toBe(false);
  });

  it("is idempotent for absent ids", async () => {
    const repo = new InMemoryRepo();
    const result = await makeDeleteArchitectureUseCase(repo).execute("ghost");
    expect(result.kind).toBe("ok");
  });
});

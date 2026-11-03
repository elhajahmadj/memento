/**
 * Filesystem-backed `ArchitectureRepository`.
 *
 * Each custom architecture is persisted as `<workspaceDir>/.architectures/<id>.json`.
 * The `workspaceDir` is read from `recorderConfig` on each call rather
 * than captured at construction time so tests that mutate
 * `recorderConfig.workspaceDir` between cases continue to work.
 *
 * IDs are validated by `assertSafeArchId` before they are joined into a
 * filename so an attacker cannot escape the `.architectures` directory
 * through `../foo` or absolute paths. We additionally re-resolve the
 * target and re-check the prefix as a defense-in-depth measure.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { recorderConfig } from "@/features/projects/infrastructure/config";

import {
  type Architecture,
  DEFAULT_LANGUAGE,
  normalizeArchSolutionType,
} from "../../domain/types";
import { ArchitectureSchema, assertSafeArchId } from "../../domain/schemas";
import { isBuiltInId } from "../../domain/builtIns";
import type { ArchitectureRepository } from "../../domain/ports/architectureRepository";

function architecturesDir(): string {
  return path.join(recorderConfig.workspaceDir, ".architectures");
}

function safeArchFilePath(id: string): string {
  assertSafeArchId(id);
  const dir = architecturesDir();
  const target = path.resolve(dir, `${id}.json`);
  const dirResolved = path.resolve(dir);
  if (!target.startsWith(dirResolved + path.sep)) {
    throw new Error("Architecture path escapes architectures directory");
  }
  return target;
}

function normalizeStored(arch: Architecture): Architecture {
  return {
    ...arch,
    isBuiltIn: false,
    language: arch.language ?? DEFAULT_LANGUAGE,
    solutionType: normalizeArchSolutionType(arch.solutionType),
  };
}

export class FilesystemArchitectureRepository
  implements ArchitectureRepository
{
  async list(): Promise<Architecture[]> {
    const dir = architecturesDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir);
      const out: Architecture[] = [];
      for (const f of entries) {
        if (!f.endsWith(".json")) continue;
        try {
          const txt = await fs.readFile(path.join(dir, f), "utf8");
          const raw = JSON.parse(txt);
          const parsed = ArchitectureSchema.safeParse(raw);
          if (parsed.success && !isBuiltInId(parsed.data.id)) {
            out.push(normalizeStored(parsed.data));
          }
        } catch {
          // skip malformed
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    } catch {
      return [];
    }
  }

  async findById(id: string): Promise<Architecture | null> {
    const all = await this.list();
    return all.find((a) => a.id === id) ?? null;
  }

  async save(arch: Architecture): Promise<Architecture> {
    const target = safeArchFilePath(arch.id);
    await fs.mkdir(architecturesDir(), { recursive: true });
    const stored = normalizeStored(arch);
    await fs.writeFile(target, JSON.stringify(stored, null, 2));
    return stored;
  }

  async delete(id: string): Promise<void> {
    const target = safeArchFilePath(id);
    try {
      await fs.unlink(target);
    } catch {
      // already absent
    }
  }
}

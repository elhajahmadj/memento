import fs from "node:fs/promises";
import path from "node:path";

export async function safeRm(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Recursively copy `src` directory contents into `dest`. Skips entries
 * named in `skip` at the top level (used to preserve `.git`).
 */
export async function copyTreeInto(
  src: string,
  dest: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => !skip.has(e.name))
      .map(async (e) => {
        const from = path.join(src, e.name);
        const to = path.join(dest, e.name);
        if (e.isDirectory()) {
          await fs.mkdir(to, { recursive: true });
          await copyTreeInto(from, to);
        } else if (e.isSymbolicLink()) {
          const target = await fs.readlink(from);
          await fs.symlink(target, to);
        } else if (e.isFile()) {
          await fs.copyFile(from, to);
        }
      }),
  );
}

/** Remove every top-level entry in `dir` except those in `keep`. */
export async function clearDirExcept(
  dir: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries
      .filter((name) => !keep.has(name))
      .map((name) => safeRm(path.join(dir, name))),
  );
}

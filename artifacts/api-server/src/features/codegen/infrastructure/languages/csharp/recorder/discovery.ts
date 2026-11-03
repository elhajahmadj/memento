import fs from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "@/features/projects/infrastructure/paths";

export interface DiscoveredProject {
  testProjectName: string;
  namespace: string;
}

// ---------------------------------------------------------------------
// Discovery — find the {Project}.Tests folder and the C# namespace.
// Falls back to the project name when the on-disk project is empty
// (e.g. the very first AI run on a freshly-scaffolded project).
// ---------------------------------------------------------------------

export async function discoverCsharpProject(
  projectRoot: string,
  projectName: string,
): Promise<DiscoveredProject> {
  // Prefer an exact `{projectName}.Tests` match; only fall back to
  // "first directory ending in .Tests" when that doesn't exist. This
  // avoids targeting the wrong project in repos that legitimately
  // contain multiple `*.Tests` folders.
  let testProjectName = `${projectName}.Tests`;
  try {
    const entries = await fs.readdir(projectRoot, { withFileTypes: true });
    const exact = entries.find(
      (e) => e.isDirectory() && e.name === `${projectName}.Tests`,
    );
    if (!exact) {
      const fallback = entries.find(
        (e) => e.isDirectory() && /\.Tests$/.test(e.name),
      );
      if (fallback) testProjectName = fallback.name;
    }
  } catch {
    // Project root missing — caller already validated this; fall through.
  }

  // Discover namespace: walk the tests folder for any *.cs file with
  // a `namespace X.Tests...` declaration and use the X portion.
  let namespace = testProjectName.replace(/\.Tests$/, "");
  try {
    const ns = await findNamespaceInDir(
      safeJoin(projectRoot, testProjectName),
    );
    if (ns) namespace = ns;
  } catch {
    // ignore — keep the projectName-based fallback
  }

  return { testProjectName, namespace };
}

async function findNamespaceInDir(dirAbs: string): Promise<string | null> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dirAbs, e.name);
    if (e.isFile() && e.name.endsWith(".cs")) {
      try {
        const txt = await fs.readFile(full, "utf8");
        const m = txt.match(/namespace\s+([A-Za-z0-9_.]+?)(?:\.Tests\b|;|\s*\{)/);
        if (m?.[1]) return m[1];
      } catch {
        // ignore
      }
    } else if (e.isDirectory() && !["bin", "obj", ".vs"].includes(e.name)) {
      const found = await findNamespaceInDir(full);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Pull the first `class Foo` declaration out of an existing suite
 * file so the add_method emitter can attach a `partial class Foo`
 * companion. Returns null when the file is unreadable or contains no
 * class declaration (the caller falls back to the basename).
 */
export async function readExistingClassAndNamespace(
  projectRoot: string,
  existingSuiteFile: string,
): Promise<{ className: string | null; namespace: string | null }> {
  try {
    const abs = safeJoin(projectRoot, existingSuiteFile);
    const txt = await fs.readFile(abs, "utf8");
    // Tolerate `partial`, `abstract`, `sealed`, `public/internal`,
    // generics, and inheritance — we only need the bare class name.
    const cm = txt.match(
      /\b(?:public|internal|private|protected)?\s*(?:abstract\s+|sealed\s+|static\s+)?(?:partial\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/,
    );
    // Match both file-scoped (`namespace Foo;`) and braced
    // (`namespace Foo { ... }`) declarations. The companion partial
    // class MUST live in this namespace or C# won't merge it with
    // the user-selected suite class.
    const nm = txt.match(
      /\bnamespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:;|\{)/,
    );
    return { className: cm?.[1] ?? null, namespace: nm?.[1] ?? null };
  } catch {
    return { className: null, namespace: null };
  }
}

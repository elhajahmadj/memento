import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "../../domain/types";

/**
 * Recursively delete every file inside `dirAbs`, preserving any
 * `.gitkeep` placeholders and the directory itself. Empty subdirectories
 * that result are removed. No-op when `dirAbs` doesn't exist. Refuses to
 * traverse outside `rootPath`.
 */
export async function clearDirContents(
  rootPath: string,
  dirAbs: string,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDir = path.resolve(dirAbs);
  if (
    resolvedDir !== resolvedRoot &&
    !resolvedDir.startsWith(resolvedRoot + path.sep)
  ) {
    return;
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      await clearDirContents(rootPath, child);
      try {
        const remaining = await fs.readdir(child);
        const onlyPlaceholders = remaining.every(
          (n) => n === ".gitkeep" || n === "__init__.py",
        );
        if (remaining.length === 0 || onlyPlaceholders) {
          if (remaining.length === 0) await fs.rmdir(child);
        }
      } catch {
        // best-effort
      }
    } else if (entry.name !== ".gitkeep" && entry.name !== "__init__.py") {
      try {
        await fs.unlink(child);
      } catch {
        // best-effort
      }
    }
  }
}

export async function deleteBakFilesIn(
  rootPath: string,
  dirAbs: string,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDir = path.resolve(dirAbs);
  if (
    resolvedDir !== resolvedRoot &&
    !resolvedDir.startsWith(resolvedRoot + path.sep)
  ) {
    return;
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      await deleteBakFilesIn(rootPath, child);
    } else if (entry.name.endsWith(".bak")) {
      try {
        await fs.unlink(child);
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Delete every regular file in `dirAbs` whose name passes `predicate`,
 * preserving directory placeholders (`.gitkeep`, `__init__.py`).
 * No-op when `dirAbs` doesn't exist.
 */
export async function clearGeneratedTestFiles(
  rootPath: string,
  dirAbs: string,
  predicate: (name: string) => boolean,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDir = path.resolve(dirAbs);
  if (
    resolvedDir !== resolvedRoot &&
    !resolvedDir.startsWith(resolvedRoot + path.sep)
  ) {
    return;
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === ".gitkeep") continue;
    if (entry.name === "__init__.py") continue;
    if (!predicate(entry.name)) continue;
    try {
      await fs.unlink(path.join(dirAbs, entry.name));
    } catch {
      // best-effort
    }
  }
}

/**
 * Empty out the named-URL block in a per-project `appsettings.json`,
 * preserving every other key. Handles two shapes:
 *   - UI scaffolds:  top-level `Urls: { ... }` → `Urls: {}`
 *   - API scaffolds: nested `ApiTest.Urls: { ... }` → `ApiTest.Urls: {}`
 */
export async function resetAppsettingsUrls(
  settingsPath: string,
): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(settingsPath, "utf8");
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

  const root = parsed as Record<string, unknown>;
  let changed = false;
  if ("Urls" in root) {
    root.Urls = {};
    changed = true;
  }
  if (
    "ApiTest" in root &&
    root.ApiTest &&
    typeof root.ApiTest === "object" &&
    !Array.isArray(root.ApiTest)
  ) {
    const apiTest = root.ApiTest as Record<string, unknown>;
    if ("Urls" in apiTest) {
      apiTest.Urls = {};
      changed = true;
    }
  }
  if (!changed) return;
  await fs.writeFile(settingsPath, `${JSON.stringify(root, null, 2)}\n`);
}

/**
 * Remove every `<SOLUTION>_URL_*=…` line from `<root>/.env`, preserving
 * every other line verbatim. No-op when `.env` is missing.
 */
export async function stripUrlEnvLines(project: Project): Promise<void> {
  const envPath = path.join(project.rootPath, ".env");
  let raw: string;
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch {
    return;
  }
  const safeSolution = project.solutionName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  const prefix = `${safeSolution}_URL_`;
  const trailingNewline = raw.endsWith("\n");
  const lines = raw.split(/\r?\n/);
  if (trailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const kept = lines.filter((line) => {
    let probe = line.replace(/^\s+/, "");
    if (probe.startsWith("export ")) {
      probe = probe.slice("export ".length).replace(/^\s+/, "");
    }
    if (!probe.startsWith(prefix)) return true;
    const eq = probe.indexOf("=");
    return eq <= prefix.length;
  });
  const joined = kept.join("\n");
  await fs.writeFile(envPath, trailingNewline ? `${joined}\n` : joined);
}

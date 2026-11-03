import path from "node:path";

/**
 * Resolves a user-supplied project-relative path against the project root,
 * rejecting any path that escapes the root via `..` or absolute paths.
 */
export function safeJoin(rootPath: string, relPath: string): string {
  const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe path: ${relPath}`);
  }
  const resolved = path.resolve(rootPath, normalized);
  const rootResolved = path.resolve(rootPath);
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(rootResolved + path.sep)
  ) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return resolved;
}

export function toRelative(rootPath: string, absPath: string): string {
  return path.relative(rootPath, absPath).split(path.sep).join("/");
}

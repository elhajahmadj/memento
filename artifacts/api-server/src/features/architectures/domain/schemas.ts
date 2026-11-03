/**
 * Zod schemas for architectures + safe-path-segment helpers.
 *
 * Architecture file/folder names are written verbatim to disk during
 * scaffolding, so they must be plain single-segment names — these
 * schemas reject anything that could escape the project directory.
 */
import path from "node:path";
import { z } from "zod";
import type {
  ArchFile,
  ArchFolder,
  ArchProject,
  ArchSolutionType,
  Architecture,
  Language,
} from "./types";

/**
 * Reject any path segment that could escape the project directory.
 * Architecture file/folder names are written verbatim to disk during
 * scaffolding, so they must be plain single-segment names.
 */
const RESERVED_NAMES = new Set([".", "..", ""]);
export function isSafePathSegment(name: string): boolean {
  if (typeof name !== "string") return false;
  if (RESERVED_NAMES.has(name)) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  if (path.isAbsolute(name)) return false;
  // Disallow leading/trailing whitespace which is rarely intended and
  // can confuse path handling on some filesystems.
  if (name !== name.trim()) return false;
  return true;
}

const safeSegment = (label: string) =>
  z.string().refine(isSafePathSegment, {
    message: `${label} must be a plain file/folder name (no slashes, "..", or absolute paths)`,
  });

export const ArchFileSchema: z.ZodType<ArchFile> = z.object({
  name: safeSegment("File name"),
  content: z.string(),
});

export const ArchFolderSchema: z.ZodType<ArchFolder> = z.lazy(() =>
  z.object({
    name: safeSegment("Folder name"),
    folders: z.array(ArchFolderSchema),
    files: z.array(ArchFileSchema),
  }),
);

export const ArchProjectSchema: z.ZodType<ArchProject> = z.object({
  id: z.string(),
  nameSuffix: z
    .string()
    .refine((s) => !s.includes("/") && !s.includes("\\") && !s.includes("\0"), {
      message: "Project name suffix cannot contain path separators",
    })
    .refine((s) => !s.includes(".."), {
      message: 'Project name suffix cannot contain ".."',
    }),
  isTestsProject: z.boolean(),
  slnGuid: z.string(),
  folders: z.array(ArchFolderSchema),
  files: z.array(ArchFileSchema),
});

export const LanguageSchema: z.ZodType<Language> = z.union([
  z.literal("csharp"),
  z.literal("python"),
  z.literal("nodejs"),
  z.literal("java"),
  z.literal("jmx"),
]);

export const ArchSolutionTypeSchema: z.ZodType<ArchSolutionType> = z.union([
  z.literal("playwright"),
  z.literal("api"),
]);

export const ArchitectureSchema: z.ZodType<Architecture> = z.object({
  id: z.string(),
  name: z.string().min(1),
  isBuiltIn: z.boolean(),
  language: LanguageSchema.optional(),
  solutionType: ArchSolutionTypeSchema.optional(),
  projects: z.array(ArchProjectSchema),
}) as unknown as z.ZodType<Architecture>;

/**
 * Architecture ids are persisted as the filename in `.architectures/<id>.json`.
 * Restrict them to a safe character set so an attacker cannot escape the
 * `.architectures` directory through values like `../foo` or absolute paths.
 */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function assertSafeArchId(id: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(
      "Architecture id must be 1-64 chars of letters, digits, underscore or hyphen",
    );
  }
}

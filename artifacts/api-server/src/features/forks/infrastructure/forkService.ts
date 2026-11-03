import fs from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import {
  db,
  forksTable,
  usersTable,
  type Fork,
  type User,
} from "@workspace/db";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import {
  FORKS_SUBDIR,
  listAvailableProjects,
} from "@/features/projects/infrastructure/projectService";
import type { Language } from "@/features/architectures/infrastructure/architectureService";
import type { SolutionType } from "@/features/projects/infrastructure/projectService";

// Allow `@` and `+` so email-as-username accounts (created via the
// IDP-provisioned Add User flow) can still own forks. Both characters
// are filesystem-safe on Linux and macOS and we deliberately disallow
// `/`, `\`, `..`, and shell metacharacters.
const VALID_USERNAME = /^[A-Za-z0-9_.+@-]+$/;
const VALID_PROJECT = /^[A-Za-z][A-Za-z0-9_.-]*$/;

function assertSafeUsername(username: string): void {
  if (!VALID_USERNAME.test(username)) {
    throw new Error(`Unsafe username: ${username}`);
  }
}

function assertSafeProjectName(projectName: string): void {
  if (!VALID_PROJECT.test(projectName)) {
    throw new Error(`Unsafe project name: ${projectName}`);
  }
}

export function userForkRoot(username: string): string {
  assertSafeUsername(username);
  return path.join(recorderConfig.workspaceDir, FORKS_SUBDIR, username);
}

export function forkProjectDir(username: string, projectName: string): string {
  assertSafeProjectName(projectName);
  return path.join(userForkRoot(username), projectName);
}

export function forkSlnPath(username: string, projectName: string): string {
  return path.join(forkProjectDir(username, projectName), `${projectName}.sln`);
}

function mainProjectDir(projectName: string): string {
  assertSafeProjectName(projectName);
  return path.join(recorderConfig.workspaceDir, projectName);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursively copy a directory tree, skipping bin/obj-style noise. */
async function copyTree(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (recorderConfig.ignoreDirs.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

/**
 * Copy a project tree (under workspace/<projectName>) into the fork location
 * for the given user. Throws if the source project does not exist or the fork
 * directory already exists.
 */
export async function copyProjectIntoFork(
  username: string,
  projectName: string,
): Promise<string> {
  const src = mainProjectDir(projectName);
  if (!(await exists(src))) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const dst = forkProjectDir(username, projectName);
  if (await exists(dst)) {
    throw new Error(`Fork directory already exists: ${dst}`);
  }
  await fs.mkdir(userForkRoot(username), { recursive: true });
  await copyTree(src, dst);
  return dst;
}

export async function removeForkTree(forkPath: string): Promise<void> {
  const wsRoot = path.resolve(
    recorderConfig.workspaceDir,
    FORKS_SUBDIR,
  );
  const abs = path.resolve(forkPath);
  if (abs !== wsRoot && !abs.startsWith(wsRoot + path.sep)) {
    throw new Error("Refusing to remove fork outside the forks directory");
  }
  await fs.rm(abs, { recursive: true, force: true });
}

export interface ForkRow extends Fork {
  username: string;
}

export async function listAllForks(): Promise<ForkRow[]> {
  const rows = await db
    .select({
      fork: forksTable,
      username: usersTable.username,
    })
    .from(forksTable)
    .innerJoin(usersTable, eq(forksTable.userId, usersTable.id));
  return rows.map((r) => ({ ...r.fork, username: r.username }));
}

export async function listForksForUser(userId: string): Promise<ForkRow[]> {
  const rows = await db
    .select({
      fork: forksTable,
      username: usersTable.username,
    })
    .from(forksTable)
    .innerJoin(usersTable, eq(forksTable.userId, usersTable.id))
    .where(eq(forksTable.userId, userId));
  return rows.map((r) => ({ ...r.fork, username: r.username }));
}

export async function getForkById(id: string): Promise<ForkRow | null> {
  const rows = await db
    .select({
      fork: forksTable,
      username: usersTable.username,
    })
    .from(forksTable)
    .innerJoin(usersTable, eq(forksTable.userId, usersTable.id))
    .where(eq(forksTable.id, id))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.fork, username: row.username } : null;
}

export async function getForkForUser(
  userId: string,
  projectName: string,
): Promise<ForkRow | null> {
  const rows = await db
    .select({
      fork: forksTable,
      username: usersTable.username,
    })
    .from(forksTable)
    .innerJoin(usersTable, eq(forksTable.userId, usersTable.id))
    .where(
      and(
        eq(forksTable.userId, userId),
        eq(forksTable.projectName, projectName),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row.fork, username: row.username } : null;
}

async function findUser(userId: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Admin-create+assign a fork: copies the project tree and inserts an active
 * fork row. Throws if the user already has a fork for that project.
 */
export async function createFork(args: {
  userId: string;
  projectName: string;
  decidedBy: string;
}): Promise<ForkRow> {
  const user = await findUser(args.userId);
  if (!user) throw new Error("User not found");
  assertSafeProjectName(args.projectName);
  const existing = await getForkForUser(args.userId, args.projectName);
  if (existing) throw new Error("User already has a fork for this project");

  const dst = await copyProjectIntoFork(user.username, args.projectName);

  const [inserted] = await db
    .insert(forksTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      forkPath: dst,
      status: "active",
      decidedAt: new Date(),
      decidedBy: args.decidedBy,
    })
    .returning();
  if (!inserted) throw new Error("Failed to create fork row");
  return { ...inserted, username: user.username };
}

/** Limited-user request flow: insert a pending row (no copy yet). */
export async function requestFork(args: {
  userId: string;
  projectName: string;
}): Promise<ForkRow> {
  const user = await findUser(args.userId);
  if (!user) throw new Error("User not found");
  assertSafeProjectName(args.projectName);
  const existing = await getForkForUser(args.userId, args.projectName);
  if (existing) {
    throw new Error(
      existing.status === "pending"
        ? "A fork request is already pending for this project"
        : "You already have a fork for this project",
    );
  }
  const projectMain = mainProjectDir(args.projectName);
  if (!(await exists(projectMain))) {
    throw new Error(`Project not found: ${args.projectName}`);
  }
  const intendedPath = forkProjectDir(user.username, args.projectName);
  const [inserted] = await db
    .insert(forksTable)
    .values({
      userId: args.userId,
      projectName: args.projectName,
      forkPath: intendedPath,
      status: "pending",
    })
    .returning();
  if (!inserted) throw new Error("Failed to create fork request");
  return { ...inserted, username: user.username };
}

export async function approveFork(args: {
  forkId: string;
  decidedBy: string;
}): Promise<ForkRow> {
  const row = await getForkById(args.forkId);
  if (!row) throw new Error("Fork not found");
  if (row.status === "active") return row;
  // Materialize the fork directory now.
  // If the directory already exists from a prior partial run, error out so
  // the admin can investigate.
  if (await exists(row.forkPath)) {
    // Treat as already-materialized: just flip status.
  } else {
    await copyProjectIntoFork(row.username, row.projectName);
  }
  const [updated] = await db
    .update(forksTable)
    .set({
      status: "active",
      decidedAt: new Date(),
      decidedBy: args.decidedBy,
    })
    .where(eq(forksTable.id, args.forkId))
    .returning();
  if (!updated) throw new Error("Failed to approve fork");
  return { ...updated, username: row.username };
}

export async function denyFork(args: {
  forkId: string;
  decidedBy: string;
}): Promise<void> {
  const row = await getForkById(args.forkId);
  if (!row) throw new Error("Fork not found");
  if (row.status !== "pending") {
    throw new Error("Only pending fork requests can be denied");
  }
  await db.delete(forksTable).where(eq(forksTable.id, args.forkId));
}

export async function deleteFork(forkId: string): Promise<void> {
  const row = await getForkById(forkId);
  if (!row) throw new Error("Fork not found");
  if (row.status === "active") {
    await removeForkTree(row.forkPath);
  }
  await db.delete(forksTable).where(eq(forksTable.id, forkId));
}

/**
 * Resolve which Project (sln file path) a given user is allowed to operate on
 * for the given main-project name. Admins always get the main project.
 * Limited users only see their active fork.
 */
export async function resolveProjectForUser(args: {
  user: Pick<User, "id" | "role" | "username">;
  projectName: string;
}): Promise<{ slnPath: string; isFork: boolean } | null> {
  if (args.user.role === "admin" || args.user.role === "limited_admin") {
    // Limited admins also operate on the main project tree, but only for
    // projects they are assigned to. Authorization is enforced at the
    // route layer; here we just resolve the path.
    const main = path.join(
      mainProjectDir(args.projectName),
      `${args.projectName}.sln`,
    );
    if (await exists(main)) return { slnPath: main, isFork: false };
    return null;
  }
  const fork = await getForkForUser(args.user.id, args.projectName);
  if (!fork || fork.status !== "active") return null;
  const sln = path.join(fork.forkPath, `${args.projectName}.sln`);
  if (!(await exists(sln))) return null;
  return { slnPath: sln, isFork: true };
}

/**
 * Which "main" projects are visible to a Limited user as forkable? This is
 * the union of (already-forked + pending + main projects in workspace).
 */
export async function listAvailableProjectsForUser(args: {
  user: Pick<User, "id" | "role" | "username">;
  /**
   * Optional org-scope filter. When provided, the returned list is
   * restricted to projects stamped with this organization (matching the
   * scoping rule used everywhere else for OIDC users). Pass `null` to
   * disable scoping (local users / pre-org behavior).
   */
  visibleProjectNames?: ReadonlySet<string> | null;
}): Promise<
  Array<{
    projectName: string;
    slnPath: string;
    forkStatus: "none" | "pending" | "active";
    forkId: string | null;
    forkPath: string | null;
    disabled: boolean;
    language: Language;
    solutionType: SolutionType;
  }>
> {
  const main = await listAvailableProjects();
  const forks = await listForksForUser(args.user.id);
  const byName = new Map(forks.map((f) => [f.projectName, f]));
  const filtered = args.visibleProjectNames
    ? main.filter((p) => args.visibleProjectNames!.has(p.solutionName))
    : main;
  return filtered.map((p) => {
    const f = byName.get(p.solutionName);
    return {
      projectName: p.solutionName,
      slnPath: p.slnPath,
      disabled: p.disabled,
      forkStatus: (f?.status ?? "none") as "none" | "pending" | "active",
      forkId: f?.id ?? null,
      forkPath: f?.forkPath ?? null,
      language: p.language,
      solutionType: p.solutionType,
    };
  });
}

/**
 * End-to-end regression for "Try the demo" → workbench Explorer
 * populated. Boots the actual express app, logs in a real user, hits
 * `POST /api/projects/demo`, then asserts that the very next
 * `GET /api/projects/tree` (the request the workbench's Explorer fires
 * on mount) returns 200 with a non-empty MementoDemo tree.
 *
 * Before task #104 the demo flow could "succeed" against a missing
 * directory, the tree request returned 404, and the Explorer panel sat
 * on its falsy-tree "Loading…" branch forever. This test pins the
 * server contract so that regression cannot recur silently.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recorderConfig } from "@/features/projects/infrastructure/config";
import { setCurrentProject } from "@/features/projects/infrastructure/projectService";
import {
  bootServer,
  deleteUserByUsername,
  login,
  provisionUser,
  withCookie,
} from "@/shared/test-helpers";

let baseUrl: string;
let close: () => Promise<void>;
let cookie: string;
let userId: string;
let tmp: string;
let originalWorkspace: string;
const USERNAME = "vitest-demo-flow";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rec-demo-flow-"));
  originalWorkspace = recorderConfig.workspaceDir;
  recorderConfig.workspaceDir = tmp;

  ({ baseUrl, close } = await bootServer());
  const u = await provisionUser({ username: USERNAME, role: "admin" });
  userId = u.id;
  cookie = await login(baseUrl, USERNAME);
});

afterAll(async () => {
  setCurrentProject(null, userId);
  await deleteUserByUsername(USERNAME);
  await close();
  recorderConfig.workspaceDir = originalWorkspace;
  await fs.rm(tmp, { recursive: true, force: true });
});

afterEach(() => {
  setCurrentProject(null, userId);
});

describe("Try the demo → workbench Explorer flow", () => {
  it("ends up with a populated project tree the workbench can render", async () => {
    const demoRes = await fetch(`${baseUrl}/api/projects/demo`, {
      method: "POST",
      headers: withCookie(cookie),
    });
    expect(demoRes.status).toBe(201);

    const currentRes = await fetch(`${baseUrl}/api/projects/current`, {
      headers: withCookie(cookie),
    });
    expect(currentRes.status).toBe(200);
    const currentBody = (await currentRes.json()) as {
      project: { solutionName: string } | null;
    };
    expect(currentBody.project?.solutionName).toBe("MementoDemo");

    const treeRes = await fetch(`${baseUrl}/api/projects/tree`, {
      headers: withCookie(cookie),
    });
    expect(treeRes.status).toBe(200);
    const tree = (await treeRes.json()) as TreeNode;
    expect(tree.type).toBe("folder");
    expect(tree.name).toBe("MementoDemo");
    expect(tree.children?.length ?? 0).toBeGreaterThan(0);
  });

  it("recovers when the demo directory has been wiped between the two clicks", async () => {
    // Arrange: scaffold once so the workspace has the demo on disk.
    const first = await fetch(`${baseUrl}/api/projects/demo`, {
      method: "POST",
      headers: withCookie(cookie),
    });
    expect(first.status).toBe(201);

    // Wipe the on-disk directory out from under the in-memory current
    // project pointer (mirrors what would happen if an admin deleted
    // the workspace folder, or if the server was restarted with a
    // fresh disk while the client still navigated to /workbench).
    await fs.rm(path.join(tmp, "MementoDemo"), {
      recursive: true,
      force: true,
    });

    // The very next "Try the demo" click should put the user back into
    // a workable state — not a permanent 404 spinner.
    const second = await fetch(`${baseUrl}/api/projects/demo`, {
      method: "POST",
      headers: withCookie(cookie),
    });
    expect(second.status).toBe(201);

    const treeRes = await fetch(`${baseUrl}/api/projects/tree`, {
      headers: withCookie(cookie),
    });
    expect(treeRes.status).toBe(200);
    const tree = (await treeRes.json()) as TreeNode;
    expect(tree.children?.length ?? 0).toBeGreaterThan(0);
  });
});

import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Combined end-to-end coverage for task #43 — project lifecycle
 * approvals (create + delete) walked through in a single run:
 *
 *   1. User submits a New Project request → server returns a pending
 *      lifecycle row (`kind=create`).
 *   2. Admin approves the create request → the project materializes
 *      in `/api/projects/available`.
 *   3. Limited admin files a delete on that same project → server
 *      returns a pending lifecycle row (`kind=delete`).
 *   4. Admin approves the delete request → project files are gone.
 *
 * Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) so it drives
 * the live api-server + test-builder workflows behind the shared proxy.
 */
const BASE = process.env.E2E_API_BASE_URL;
const SUITE_TAG = `e2e_lifecycle_${Date.now()}`;
// All three actors share a per-suite org so the create-request flow
// (which is org-scoped only — see `routes/index.ts` and the task #40
// investigation) is actually exercised. The dev-login route's `?org=`
// shortcut (task #40) provisions an ephemeral organization and joins
// the user as an SSO member with the requested role.
const SUITE_ORG = SUITE_TAG;

type Role = "admin" | "limited_admin" | "user";

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: Role,
): Promise<void> {
  // `user` is not a server-side role; dev-login's role inference maps
  // anything non-admin to `limited`, but we send the explicit value
  // dev-login understands (`limited`) so the per-org membership row is
  // written deterministically.
  const wireRole = role === "user" ? "limited" : role;
  const res = await request.get(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(username)}&role=${wireRole}&org=${encodeURIComponent(SUITE_ORG)}`,
  );
  expect(res.ok(), `dev-login(${username},${role}) failed`).toBeTruthy();
}

async function listAvailable(
  request: APIRequestContext,
): Promise<Array<{ solutionName: string }>> {
  const res = await request.get(`${BASE}/api/projects/available`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{ solutionName: string }>;
}

async function listPendingRequests(
  request: APIRequestContext,
): Promise<Array<{ id: string; kind: string; projectName: string }>> {
  const res = await request.get(
    `${BASE}/api/projects/lifecycle-requests?status=pending`,
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{
    id: string;
    kind: string;
    projectName: string;
  }>;
}

test.describe("project lifecycle approvals — create then delete (#43)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  const adminUser = `${SUITE_TAG}_admin`;
  const limitedAdminUser = `${SUITE_TAG}_ladmin`;
  const userUser = `${SUITE_TAG}_user`;
  const projectName = `E2E_Lifecycle_${Date.now()}`;

  test("user create-request → admin approve → ladmin delete-request → admin approve", async ({
    request,
  }) => {
    // Provision the three distinct accounts up front so approver != requester.
    await devLogin(request, adminUser, "admin");
    await devLogin(request, limitedAdminUser, "limited_admin");
    await devLogin(request, userUser, "user");

    // --- 1. User files a create request --------------------------
    await devLogin(request, userUser, "user");
    const createRes = await request.post(`${BASE}/api/projects`, {
      data: {
        solutionName: projectName,
        testProjectName: `${projectName}Tests`,
        namespace: "Memento.E2E",
        language: "csharp",
      },
    });
    // The user-create-request → admin approval flow is gated on
    // org-scoped (SSO) policy. Task #40 made the dev-login `?org=`
    // shortcut provision an SSO membership for the suite, so this
    // path is now always exercised end-to-end instead of silently
    // skipped on local installs.
    expect(createRes.status(), await createRes.text()).toBe(202);
    const createBody = (await createRes.json()) as {
      pending: boolean;
      request: { id: string; kind: string };
    };
    expect(createBody.pending).toBe(true);
    expect(createBody.request.kind).toBe("create");
    const createReqId = createBody.request.id;

    // Project must not yet appear in the catalog.
    await devLogin(request, adminUser, "admin");
    expect(
      (await listAvailable(request)).some((p) => p.solutionName === projectName),
    ).toBe(false);

    // --- 2. Admin approves the create request --------------------
    const approveCreate = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${createReqId}/approve`,
      { data: {} },
    );
    expect(approveCreate.ok(), await approveCreate.text()).toBeTruthy();

    expect(
      (await listAvailable(request)).some((p) => p.solutionName === projectName),
      "approved create request must materialize the project",
    ).toBe(true);
    expect(
      (await listPendingRequests(request)).some((r) => r.id === createReqId),
      "approved create request should be gone from pending list",
    ).toBe(false);

    // Capture slnPath now that the project exists.
    const available = await listAvailable(request);
    const projRow = available.find(
      (p) => p.solutionName === projectName,
    ) as { solutionName: string; slnPath?: string } | undefined;
    expect(projRow).toBeDefined();
    expect(projRow!.slnPath, "approved create must expose slnPath").toBeTruthy();
    const slnPath = projRow!.slnPath!;

    // --- 3. Limited admin files a delete -------------------------
    await devLogin(request, limitedAdminUser, "limited_admin");
    const fileDelete = await request.post(`${BASE}/api/projects/delete`, {
      data: { slnPath },
    });
    expect(fileDelete.status(), await fileDelete.text()).toBe(200);
    const deleteBody = (await fileDelete.json()) as {
      status: string;
      requestId: string | null;
    };
    expect(deleteBody.status).toBe("pending");
    expect(deleteBody.requestId).toBeTruthy();
    const deleteReqId = deleteBody.requestId!;

    // Project still on disk while pending.
    await devLogin(request, adminUser, "admin");
    expect(
      (await listAvailable(request)).some((p) => p.solutionName === projectName),
    ).toBe(true);

    // --- 4. Admin approves the delete request --------------------
    const approveDelete = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${deleteReqId}/approve`,
      { data: {} },
    );
    expect(approveDelete.ok(), await approveDelete.text()).toBeTruthy();

    expect(
      (await listAvailable(request)).some((p) => p.solutionName === projectName),
      "approved delete must remove the project from the catalog",
    ).toBe(false);
    expect(
      (await listPendingRequests(request)).some((r) => r.id === deleteReqId),
      "approved delete request should be gone from pending list",
    ).toBe(false);
  });
});

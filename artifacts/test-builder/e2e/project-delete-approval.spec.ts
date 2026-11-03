import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * End-to-end coverage for task #42 — admin approval to delete a project.
 *
 * Exercises four scenarios end-to-end via the live api-server +
 * test-builder workflows (gated on E2E_API_BASE_URL):
 *   1. limited_admin files a delete → response is `pending` and the
 *      project files remain on disk.
 *   2. admin approves the pending delete → project files are gone.
 *   3. admin rejects a different pending delete → project files remain.
 *   4. sole-admin path requires `acknowledgeIrreversible` — without it
 *      the server returns 400, with it the project deletes immediately.
 *      The "sole admin" precondition is set up by demoting the seeded
 *      `Admin` user to `memento_admin` for the duration of this spec.
 *
 * Tests are sequential because they share the test-runtime admin/limited
 * admin users and the live filesystem.
 */
const BASE = process.env.E2E_API_BASE_URL;

const SUITE_TAG = `e2e_delete_${Date.now()}`;
// Per-suite org so the sole-admin path (scenario 4) is deterministic
// without having to demote seeded admins. Task #40.
const SUITE_ORG = SUITE_TAG;

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: "admin" | "limited_admin",
): Promise<void> {
  const res = await request.get(
    `${BASE}/api/auth/dev-login?email=${encodeURIComponent(username)}&role=${role}&org=${encodeURIComponent(SUITE_ORG)}`,
  );
  expect(res.ok(), `dev-login(${username},${role}) failed`).toBeTruthy();
}

async function createProject(
  request: APIRequestContext,
  solutionName: string,
): Promise<{ slnPath: string; solutionName: string }> {
  const res = await request.post(`${BASE}/api/projects`, {
    data: {
      solutionName,
      namespace: `${solutionName}.QA`,
      testProjectName: `${solutionName}.Tests`,
    },
  });
  expect(res.ok(), `create ${solutionName}: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { slnPath: string; solutionName: string };
  return body;
}

async function projectExists(
  request: APIRequestContext,
  solutionName: string,
): Promise<boolean> {
  const res = await request.get(`${BASE}/api/projects/available`);
  if (!res.ok()) return false;
  const rows = (await res.json()) as Array<{ solutionName: string }>;
  return rows.some((r) => r.solutionName === solutionName);
}

test.describe("project delete approval flow (#42)", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  const adminUser = `${SUITE_TAG}_admin`;
  const limitedAdminUser = `${SUITE_TAG}_ladmin`;

  test("limited_admin → admin approves; admin rejects another; sole-admin ack path", async ({
    request,
  }) => {
    // --- Provision two distinct users so approver !== requester. ----
    await devLogin(request, adminUser, "admin");
    await devLogin(request, limitedAdminUser, "limited_admin");

    // --- Scenario 1: limited_admin files a delete → pending --------
    await devLogin(request, adminUser, "admin");
    const projA = await createProject(request, `E2E_DelApprove_${Date.now()}`);
    await devLogin(request, limitedAdminUser, "limited_admin");
    const fileRes = await request.post(`${BASE}/api/projects/delete`, {
      data: { slnPath: projA.slnPath },
    });
    expect(fileRes.status()).toBe(200);
    const fileBody = (await fileRes.json()) as {
      status: string;
      requestId: string;
    };
    expect(fileBody.status).toBe("pending");
    expect(typeof fileBody.requestId).toBe("string");
    expect(await projectExists(request, projA.solutionName)).toBe(true);

    // --- Scenario 2: admin approves → project removed --------------
    await devLogin(request, adminUser, "admin");
    const approveRes = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${fileBody.requestId}/approve`,
    );
    expect(approveRes.status()).toBe(200);
    expect(await projectExists(request, projA.solutionName)).toBe(false);

    // --- Scenario 3: admin rejects a different pending delete ------
    const projB = await createProject(request, `E2E_DelReject_${Date.now()}`);
    await devLogin(request, limitedAdminUser, "limited_admin");
    const fileRes2 = await request.post(`${BASE}/api/projects/delete`, {
      data: { slnPath: projB.slnPath },
    });
    const fileBody2 = (await fileRes2.json()) as { requestId: string };
    await devLogin(request, adminUser, "admin");
    const rejectRes = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${fileBody2.requestId}/reject`,
    );
    expect(rejectRes.status()).toBe(200);
    expect(await projectExists(request, projB.solutionName)).toBe(true);

    // --- Scenario 4: sole-admin ack path ---------------------------
    // adminUser is the only admin in SUITE_ORG (per-suite ephemeral
    // org provisioned by dev-login `?org=`), so the sole-admin probe
    // is deterministic — no demotion of seeded admins needed. Task #40.
    await devLogin(request, adminUser, "admin");
    const projC = await createProject(request, `E2E_DelSole_${Date.now()}`);
    // Without acknowledgeIrreversible → 400 because adminUser is the
    // sole admin in this org. Project must still exist.
    const noAck = await request.post(`${BASE}/api/projects/delete`, {
      data: { slnPath: projC.slnPath },
    });
    expect(noAck.status(), await noAck.text()).toBe(400);
    expect(await projectExists(request, projC.solutionName)).toBe(true);
    // Sole-admin path: with acknowledgeIrreversible → 200 deleted.
    const withAck = await request.post(`${BASE}/api/projects/delete`, {
      data: { slnPath: projC.slnPath, acknowledgeIrreversible: true },
    });
    expect(withAck.status()).toBe(200);
    const ackBody = (await withAck.json()) as { status: "deleted" };
    expect(ackBody.status).toBe("deleted");
    expect(await projectExists(request, projC.solutionName)).toBe(false);
  });
});

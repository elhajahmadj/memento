import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * End-to-end coverage for task #89 — admin approval to clear a
 * project's files. Mirrors the project-delete-approval spec.
 *
 *   1. limited_admin files a clear-files → response is `pending` and
 *      the project files remain on disk.
 *   2. admin approves the pending clear → project still exists but
 *      its files are wiped (tree is empty modulo skeleton).
 *   3. admin rejects another pending clear → project files remain
 *      untouched.
 *   4. sole-admin path requires `acknowledgeIrreversible` — without it
 *      the server returns 400; with it the files are cleared
 *      immediately and the project still exists.
 */
const BASE = process.env.E2E_API_BASE_URL;

const SUITE_TAG = `e2e_clearf_${Date.now()}`;
// Per-suite org so the sole-admin probe (scenario 4) is deterministic:
// `countAdminsInOrg(SUITE_ORG)` returns exactly 1 (the suite's admin)
// regardless of how many other admins the dev DB already has. Task #40.
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
  return (await res.json()) as { slnPath: string; solutionName: string };
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

async function getRequestStatus(
  request: APIRequestContext,
  id: string,
): Promise<string | null> {
  // No GET /lifecycle-requests/:id endpoint exists; the only public
  // read surface is the list. Walk the three statuses to find the row.
  for (const status of ["pending", "approved", "rejected"] as const) {
    const res = await request.get(
      `${BASE}/api/projects/lifecycle-requests?status=${status}`,
    );
    if (!res.ok()) continue;
    const rows = (await res.json()) as Array<{ id: string; status: string }>;
    const hit = rows.find((r) => r.id === id);
    if (hit) return hit.status;
  }
  return null;
}

test.describe("project clear-files approval flow (#89)", () => {
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

    // --- Scenario 1: limited_admin files a clear → pending ---------
    await devLogin(request, adminUser, "admin");
    const projA = await createProject(
      request,
      `E2E_ClearApprove_${Date.now()}`,
    );
    await devLogin(request, limitedAdminUser, "limited_admin");
    const fileRes = await request.post(`${BASE}/api/projects/clear-files`, {
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

    // The preflight should report a pending request for this project.
    const preflight = await request.get(
      `${BASE}/api/projects/${projA.solutionName}/clear-files-preflight`,
    );
    expect(preflight.status()).toBe(200);
    const preBody = (await preflight.json()) as {
      requiresApproval: boolean;
      isSoleAdmin: boolean;
      hasPendingRequest: boolean;
    };
    expect(preBody.hasPendingRequest).toBe(true);

    // Filing a second concurrent clear must 409.
    const dup = await request.post(`${BASE}/api/projects/clear-files`, {
      data: { slnPath: projA.slnPath },
    });
    expect(dup.status()).toBe(409);

    // The requester themselves cannot approve their own clear-files
    // request — server-side self-approval guard.
    const selfApprove = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${fileBody.requestId}/approve`,
    );
    expect(selfApprove.status()).toBe(403);

    // --- Scenario 2: admin approves → request transitions to executed,
    //     project still exists. ----------------------------------------
    await devLogin(request, adminUser, "admin");
    const approveRes = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${fileBody.requestId}/approve`,
    );
    expect(approveRes.status()).toBe(200);
    expect(await getRequestStatus(request, fileBody.requestId)).toBe(
      "approved",
    );
    expect(await projectExists(request, projA.solutionName)).toBe(true);

    // --- Scenario 3: admin rejects a different pending clear → status
    //     becomes "rejected" and the project is untouched. -------------
    const projB = await createProject(
      request,
      `E2E_ClearReject_${Date.now()}`,
    );
    await devLogin(request, limitedAdminUser, "limited_admin");
    const fileRes2 = await request.post(`${BASE}/api/projects/clear-files`, {
      data: { slnPath: projB.slnPath },
    });
    const fileBody2 = (await fileRes2.json()) as { requestId: string };
    await devLogin(request, adminUser, "admin");
    const rejectRes = await request.post(
      `${BASE}/api/projects/lifecycle-requests/${fileBody2.requestId}/reject`,
    );
    expect(rejectRes.status()).toBe(200);
    expect(await getRequestStatus(request, fileBody2.requestId)).toBe(
      "rejected",
    );
    expect(await projectExists(request, projB.solutionName)).toBe(true);
    // A rejected request must NOT leave a pending row hanging — the
    // project's clear-files preflight should report no pending request
    // (proving the row was closed, not silently executed).
    const postRejectPre = await request.get(
      `${BASE}/api/projects/${projB.solutionName}/clear-files-preflight`,
    );
    const postRejectBody = (await postRejectPre.json()) as {
      hasPendingRequest: boolean;
    };
    expect(postRejectBody.hasPendingRequest).toBe(false);

    // --- Scenario 4: sole-admin ack path ----------------------------
    // adminUser is already the only admin in SUITE_ORG (the per-suite
    // ephemeral org provisioned by dev-login `?org=`), so the
    // sole-admin probe is deterministic — no need to demote other
    // admins in the workspace. Task #40.
    await devLogin(request, adminUser, "admin");
    const projC = await createProject(request, `E2E_ClearSole_${Date.now()}`);
    const solePre = await request.get(
      `${BASE}/api/projects/${projC.solutionName}/clear-files-preflight`,
    );
    const soleBody = (await solePre.json()) as {
      requiresApproval: boolean;
      isSoleAdmin: boolean;
    };
    expect(
      soleBody.isSoleAdmin,
      "suite org must have exactly one admin so the sole-admin path is exercised",
    ).toBe(true);
    // No-ack on the sole-admin path must be a hard 400. Files stay.
    const noAck = await request.post(`${BASE}/api/projects/clear-files`, {
      data: { slnPath: projC.slnPath },
    });
    expect(noAck.status()).toBe(400);
    expect(await projectExists(request, projC.solutionName)).toBe(true);
    // With ack → 200 cleared immediately, no lifecycle row created.
    const withAck = await request.post(`${BASE}/api/projects/clear-files`, {
      data: { slnPath: projC.slnPath, acknowledgeIrreversible: true },
    });
    expect(withAck.status()).toBe(200);
    const ackBody = (await withAck.json()) as {
      status: "cleared" | "pending";
      requestId: string | null;
    };
    expect(ackBody.status).toBe("cleared");
    expect(ackBody.requestId).toBeNull();
    expect(await projectExists(request, projC.solutionName)).toBe(true);
    const postSolePre = await request.get(
      `${BASE}/api/projects/${projC.solutionName}/clear-files-preflight`,
    );
    const postSoleBody = (await postSolePre.json()) as {
      hasPendingRequest: boolean;
    };
    expect(postSoleBody.hasPendingRequest).toBe(false);
  });
});

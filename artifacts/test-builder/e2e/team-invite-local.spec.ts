import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  FORWARDED_HTTPS_HEADER,
  devLogin as sharedDevLogin,
  devLoginEmail,
} from "./_helpers/admin-session";

/**
 * End-to-end coverage for the Team Admin "Invite teammate" flow on the
 * local (non-IDP) delivery methods (task #16 / #23).
 *
 * Drives `POST /api/team/invitations` against the live api-server +
 * test-builder workflows behind the shared proxy. Asserts:
 *
 *   (a) a non-admin (limited) caller is rejected with 403,
 *   (b) an admin with `deliveryMethod=email` gets back the canonical
 *       invitation DTO with `status=pending`, `acceptUrl` set, the
 *       role echoed, and `firstName` / `lastName` round-tripped,
 *   (c) a follow-up `deliveryMethod=copy_link` invite for the SAME
 *       email is rejected with 409 (active invitation already exists),
 *   (d) the pending invitation surfaces on `GET /api/team/invitations`
 *       and a `DELETE /api/team/invitations/:id` revokes it (204),
 *   (e) a malformed email returns 400.
 *
 * Gated on `E2E_API_BASE_URL` (e.g. `http://localhost:80`) with
 * `APP_ENVIRONMENT=development` so `/api/auth/dev-login` is enabled.
 *
 * The IDP delivery path (which adds the SSO-required + active-org
 * gates) lives in `team-invite-idp.spec.ts`.
 */
const BASE = process.env.E2E_API_BASE_URL;
const SUITE_TAG = `e2e_team_invite_local_${Date.now()}`;

async function devLogin(
  request: APIRequestContext,
  username: string,
  role: "admin" | "limited",
): Promise<void> {
  await sharedDevLogin(request, BASE!, username, role);
}

interface InvitationDto {
  id: string;
  email: string;
  role: string;
  deliveryMethod: string;
  status: string;
  acceptUrl: string | null;
  firstName: string | null;
  lastName: string | null;
}

test.describe("Team Admin — local invite flow", () => {
  test.skip(
    !BASE,
    "Set E2E_API_BASE_URL (e.g. http://localhost:80) to run this spec.",
  );

  test.describe.configure({ mode: "serial" });
  test.use({ extraHTTPHeaders: FORWARDED_HTTPS_HEADER });

  test("non-admin caller is rejected with 403", async ({ request }) => {
    await devLogin(request, `${SUITE_TAG}_user`, "limited");
    const res = await request.post(`${BASE}/api/team/invitations`, {
      data: {
        email: `${SUITE_TAG}_target@example.com`,
        role: "limited",
        deliveryMethod: "email",
      },
    });
    expect(res.status()).toBe(403);
  });

  test("admin creates an email-delivery invitation and gets back an accept link", async ({
    request,
  }) => {
    await devLogin(request, `${SUITE_TAG}_admin`, "admin");
    const email = devLoginEmail(`${SUITE_TAG}_invitee`);
    const res = await request.post(`${BASE}/api/team/invitations`, {
      data: {
        email,
        role: "admin",
        deliveryMethod: "email",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { invitation: InvitationDto };
    expect(body.invitation.email).toBe(email);
    expect(body.invitation.role).toBe("admin");
    expect(body.invitation.deliveryMethod).toBe("email");
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.firstName).toBe("Ada");
    expect(body.invitation.lastName).toBe("Lovelace");
    expect(body.invitation.acceptUrl ?? "").toMatch(/\/accept-invite\?token=/);

    // Follow-up copy_link invite to the same email is blocked by the
    // dedupe guard — even though the admin asked for a different
    // delivery method, the route only allows one pending row per
    // email.
    const dup = await request.post(`${BASE}/api/team/invitations`, {
      data: { email, role: "limited", deliveryMethod: "copy_link" },
    });
    expect(dup.status()).toBe(409);

    // The pending invitation must be listed back to the same admin.
    const list = await request.get(`${BASE}/api/team/invitations`);
    expect(list.status()).toBe(200);
    const rows = (await list.json()) as InvitationDto[];
    const ours = rows.find((r) => r.email === email);
    expect(ours, "pending invitation should appear in list").toBeDefined();
    expect(ours!.status).toBe("pending");

    // Cleanup: revoke so re-runs don't pile up.
    const del = await request.delete(
      `${BASE}/api/team/invitations/${body.invitation.id}`,
    );
    expect(del.status()).toBe(204);
  });

  test("malformed email returns 400", async ({ request }) => {
    await devLogin(request, `${SUITE_TAG}_admin2`, "admin");
    const res = await request.post(`${BASE}/api/team/invitations`, {
      data: { email: "not-an-email", role: "limited", deliveryMethod: "email" },
    });
    expect(res.status()).toBe(400);
  });
});

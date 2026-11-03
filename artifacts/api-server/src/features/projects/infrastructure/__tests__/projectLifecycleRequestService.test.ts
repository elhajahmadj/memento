import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import {
  approveLifecycleRequest,
  createPendingCreateRequest,
  deleteLifecycleRequest,
  getLifecycleRequestById,
  listLifecycleRequests,
  listLifecycleRequestsForUser,
  listPendingCreateProjectNames,
  rejectLifecycleRequest,
} from "../projectLifecycleRequestService";
import {
  db,
  organizationsTable,
  projectLifecycleRequestsTable,
  projectOrganizationsTable,
  usersTable,
} from "@workspace/db";
import { inArray, like } from "drizzle-orm";
import {
  deleteUserByUsername,
  provisionUser,
} from "@/shared/test-helpers";

const USERNAMES = [
  "vitest-lifecycle-requester",
  "vitest-lifecycle-admin",
];
const PROJECT_PREFIX = "VitestLifecycle";
const ORG_EXTERNAL_KEY = "vitest-lifecycle-org";

let requesterId: string;
let adminId: string;
let ORG_ID: string;
let OTHER_ORG_ID: string;

async function cleanupProjects(): Promise<void> {
  await db
    .delete(projectLifecycleRequestsTable)
    .where(like(projectLifecycleRequestsTable.projectName, `${PROJECT_PREFIX}%`));
  await db
    .delete(projectOrganizationsTable)
    .where(like(projectOrganizationsTable.projectName, `${PROJECT_PREFIX}%`));
}

beforeAll(async () => {
  await db.delete(usersTable).where(inArray(usersTable.username, USERNAMES));
  await db
    .delete(organizationsTable)
    .where(
      inArray(organizationsTable.externalKey, [
        ORG_EXTERNAL_KEY,
        `${ORG_EXTERNAL_KEY}-other`,
      ]),
    );
  const [org] = await db
    .insert(organizationsTable)
    .values({ externalKey: ORG_EXTERNAL_KEY, displayName: "Vitest Lifecycle" })
    .returning();
  const [otherOrg] = await db
    .insert(organizationsTable)
    .values({
      externalKey: `${ORG_EXTERNAL_KEY}-other`,
      displayName: "Vitest Lifecycle Other",
    })
    .returning();
  ORG_ID = org!.id;
  OTHER_ORG_ID = otherOrg!.id;
  const requester = await provisionUser({
    username: USERNAMES[0]!,
    role: "limited",
  });
  const admin = await provisionUser({
    username: USERNAMES[1]!,
    role: "admin",
  });
  requesterId = requester.id;
  adminId = admin.id;
});

afterAll(async () => {
  await cleanupProjects();
  await deleteUserByUsername(USERNAMES[0]!);
  await deleteUserByUsername(USERNAMES[1]!);
  await db
    .delete(organizationsTable)
    .where(inArray(organizationsTable.id, [ORG_ID, OTHER_ORG_ID]));
});

beforeEach(async () => {
  await cleanupProjects();
});

describe("projectLifecycleRequestService", () => {
  it("creates and lists pending create requests, scoped by user and by org", async () => {
    // Stamp org so org-scoped list picks it up.
    const projectName = `${PROJECT_PREFIX}OrgScoped`;
    await db
      .insert(projectOrganizationsTable)
      .values({ projectName, organizationId: ORG_ID })
      .onConflictDoNothing();
    const req = await createPendingCreateRequest({
      projectName,
      requestedByUserId: requesterId,
      requestedByRole: "limited",
      organizationId: ORG_ID,
    });
    expect(req.status).toBe("pending");
    expect(req.kind).toBe("create");
    expect(req.requestedByUsername).toBe(USERNAMES[0]!);

    const pendingNames = await listPendingCreateProjectNames();
    expect(pendingNames.has(projectName)).toBe(true);

    const scoped = await listLifecycleRequests({
      status: "pending",
      orgScope: { orgId: ORG_ID },
    });
    expect(scoped.find((r) => r.projectName === projectName)).toBeTruthy();

    const otherOrgRows = await listLifecycleRequests({
      status: "pending",
      orgScope: { orgId: OTHER_ORG_ID },
    });
    expect(otherOrgRows.find((r) => r.projectName === projectName)).toBeFalsy();

    const mine = await listLifecycleRequestsForUser(requesterId);
    expect(mine.find((r) => r.projectName === projectName)).toBeTruthy();
  });

  it("approves a pending request", async () => {
    const projectName = `${PROJECT_PREFIX}Approve`;
    const req = await createPendingCreateRequest({
      projectName,
      requestedByUserId: requesterId,
      requestedByRole: "limited",
      organizationId: null,
    });
    const approved = await approveLifecycleRequest({
      id: req.id,
      decidedBy: adminId,
      note: "ok",
    });
    expect(approved.status).toBe("approved");
    expect(approved.decidedByUserId).toBe(adminId);
    expect(approved.decisionNote).toBe("ok");

    await expect(
      approveLifecycleRequest({ id: req.id, decidedBy: adminId }),
    ).rejects.toThrow(/already been decided/);
  });

  it("rejects a pending request", async () => {
    const projectName = `${PROJECT_PREFIX}Reject`;
    const req = await createPendingCreateRequest({
      projectName,
      requestedByUserId: requesterId,
      requestedByRole: "limited",
      organizationId: null,
    });
    const rejected = await rejectLifecycleRequest({
      id: req.id,
      decidedBy: adminId,
      note: "no thanks",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionNote).toBe("no thanks");
  });

  it("deletes (cancels) a request", async () => {
    const projectName = `${PROJECT_PREFIX}Cancel`;
    const req = await createPendingCreateRequest({
      projectName,
      requestedByUserId: requesterId,
      requestedByRole: "limited",
      organizationId: null,
    });
    await deleteLifecycleRequest(req.id);
    expect(await getLifecycleRequestById(req.id)).toBeNull();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, guestSessionsTable, usersTable } from "@workspace/db";
import {
  MAX_CONCURRENT_GUESTS,
  GUEST_TTL_MS,
} from "@/features/guest/domain/types";
import {
  attachProjectToGuest,
  createGuestSession,
  detachProjectFromGuest,
  findActiveGuestSession,
  reapExpiredGuests,
} from "@/features/guest/infrastructure/guestSessionService";

// The project reaper touches the real workspace; stub it so these
// tests only exercise the database side of the lifecycle. The
// on-disk delete is `deleteProject`, which has its own coverage.
const deleteProjectMock = vi.hoisted(() => vi.fn(async () => undefined));
const listAvailableProjectsMock = vi.hoisted(() =>
  vi.fn(async (): Promise<Array<{ slnPath: string; solutionName: string }>> => []),
);
vi.mock("@/features/projects/infrastructure/projectService", () => ({
  deleteProject: deleteProjectMock,
  listAvailableProjects: listAvailableProjectsMock,
}));

/**
 * The `guest_sessions` table is deployment-wide by design — that is the
 * whole point of the 30-slot cap — and vitest runs test files in
 * parallel against one database. So this file cannot assume it owns the
 * table: `guestProjectFlow.routes.test.ts` mints real guests through
 * `POST /auth/guest` at the same time.
 *
 * Every guest this file brings into existence is therefore tracked by
 * id, so cleanup deletes exactly ours (deleting the user cascades the
 * slot) and never a concurrent suite's live guest. Matching on the
 * generated `guest-<token>` username would sweep those away mid-test.
 */
const owned = new Set<string>();

async function cleanup(): Promise<void> {
  if (owned.size === 0) return;
  await db.delete(usersTable).where(inArray(usersTable.id, [...owned]));
  owned.clear();
}

/** `createGuestSession`, with the new row registered for cleanup. */
async function mintGuest(): ReturnType<typeof createGuestSession> {
  const result = await createGuestSession();
  if (result.kind === "created") owned.add(result.userId);
  return result;
}

async function countActiveGuests(now = new Date()): Promise<number> {
  const rows = await db.select().from(guestSessionsTable);
  return rows.filter((r) => r.expiresAt > now).length;
}

/** Seed `n` occupied slots directly, bypassing the cap. */
async function seedGuests(n: number, expiresAt: Date): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [u] = await db
      .insert(usersTable)
      .values({
        username: `guest-seed-${Date.now()}-${i}-${Math.round(i * 7919)}`,
        role: "guest",
        authSource: "guest",
      })
      .returning({ id: usersTable.id });
    await db
      .insert(guestSessionsTable)
      .values({ userId: u!.id, expiresAt });
    ids.push(u!.id);
    owned.add(u!.id);
  }
  return ids;
}

/**
 * Fill the cap to `MAX_CONCURRENT_GUESTS - free`, counting whatever
 * live guests another suite already holds. Seeding a fixed
 * `MAX - 1` only works on an empty table.
 */
async function fillToLeaveFree(free: number): Promise<void> {
  const active = await countActiveGuests();
  const target = MAX_CONCURRENT_GUESTS - free;
  if (active > target) {
    throw new Error(
      `cannot leave ${free} slots free: ${active} already occupied`,
    );
  }
  await seedGuests(target - active, new Date(Date.now() + GUEST_TTL_MS));
}

afterEach(async () => {
  vi.clearAllMocks();
  listAvailableProjectsMock.mockResolvedValue([]);
  await cleanup();
});

describe("createGuestSession", () => {
  it("mints a guest user with a complete profile so the AuthGate lets them in", async () => {
    const result = await mintGuest();
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, result.userId));
    expect(user?.role).toBe("guest");
    expect(user?.authSource).toBe("guest");
    expect(user?.passwordHash).toBeNull();
    // A guest bounced to /profile/complete could never reach the app.
    expect(user?.firstName?.trim()).toBeTruthy();
    expect(user?.lastName?.trim()).toBeTruthy();
    expect(user?.title?.trim()).toBeTruthy();
    expect(user?.email).toMatch(/@/);
    // The 5-step coachmark tour walks through Settings surfaces guests
    // cannot reach, so they must start already past it.
    expect(user?.hasSeenTour).toBe(true);
  });

  it("sets the deadline TTL ahead of now and starts with no project", async () => {
    const before = Date.now();
    const result = await mintGuest();
    if (result.kind !== "created") throw new Error("expected created");

    const delta = result.expiresAt.getTime() - before;
    // Allow slack for clock/round-trip, but pin the magnitude.
    expect(delta).toBeGreaterThan(GUEST_TTL_MS - 60_000);
    expect(delta).toBeLessThanOrEqual(GUEST_TTL_MS + 60_000);

    const row = await findActiveGuestSession(result.userId);
    expect(row?.projectName).toBeNull();
  });

  it("allows the last free slot and refuses the one after it", async () => {
    await fillToLeaveFree(1);
    expect(await countActiveGuests()).toBe(MAX_CONCURRENT_GUESTS - 1);

    const last = await mintGuest();
    expect(last.kind).toBe("created");
    expect(await countActiveGuests()).toBe(MAX_CONCURRENT_GUESTS);

    const overflow = await mintGuest();
    expect(overflow.kind).toBe("at_capacity");
    // The refusal must not have left a partial user row behind.
    expect(await countActiveGuests()).toBe(MAX_CONCURRENT_GUESTS);
  });

  it("does not count expired slots against the cap", async () => {
    const past = new Date(Date.now() - 1000);
    await seedGuests(MAX_CONCURRENT_GUESTS, past);
    // Every seeded slot is already expired, so the cap is wide open.
    const result = await mintGuest();
    expect(result.kind).toBe("created");
  });

  it("never overshoots the cap under concurrent claims", async () => {
    await fillToLeaveFree(2);

    // Six simultaneous clicks against two free slots. Without the
    // advisory lock every one of these reads the same pre-insert count
    // and inserts, blowing past the cap.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => mintGuest()),
    );
    const created = results.filter((r) => r.kind === "created").length;
    // The cap is what's under test, not the exact split: a guest minted
    // by a concurrent suite legitimately takes one of the two slots.
    expect(created).toBeLessThanOrEqual(2);
    expect(created + results.filter((r) => r.kind === "at_capacity").length)
      .toBe(6);
    expect(await countActiveGuests()).toBeLessThanOrEqual(
      MAX_CONCURRENT_GUESTS,
    );
  });
});

describe("findActiveGuestSession", () => {
  it("returns null once the deadline has passed", async () => {
    const [userId] = await seedGuests(1, new Date(Date.now() + 5_000));
    expect(await findActiveGuestSession(userId!)).not.toBeNull();
    // Ask "is this still active" from a point after the deadline.
    const later = new Date(Date.now() + 10_000);
    expect(await findActiveGuestSession(userId!, later)).toBeNull();
  });

  it("returns null for an unknown user", async () => {
    expect(
      await findActiveGuestSession("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("attachProjectToGuest", () => {
  it("binds the first project and refuses a second", async () => {
    const result = await mintGuest();
    if (result.kind !== "created") throw new Error("expected created");

    expect(await attachProjectToGuest(result.userId, "FirstProject")).toBe(true);
    // The conditional `project_name IS NULL` update is what enforces
    // one-project-per-guest against a concurrent second create.
    expect(await attachProjectToGuest(result.userId, "SecondProject")).toBe(
      false,
    );

    const row = await findActiveGuestSession(result.userId);
    expect(row?.projectName).toBe("FirstProject");
  });

  it("releases the reservation on detach so a failed scaffold can retry", async () => {
    const result = await mintGuest();
    if (result.kind !== "created") throw new Error("expected created");

    await attachProjectToGuest(result.userId, "DoomedProject");
    await detachProjectFromGuest(result.userId);

    expect(
      (await findActiveGuestSession(result.userId))?.projectName,
    ).toBeNull();
    expect(await attachProjectToGuest(result.userId, "RetryProject")).toBe(true);
  });
});

describe("reapExpiredGuests", () => {
  it("leaves unexpired guests alone", async () => {
    const result = await mintGuest();
    if (result.kind !== "created") throw new Error("expected created");

    // Asserting a global `sessionsReaped === 0` would be a claim about
    // every other suite's guests too; the survival of ours is the point.
    await reapExpiredGuests();
    expect(await findActiveGuestSession(result.userId)).not.toBeNull();
  });

  it("hard-deletes the user row (cascading the slot) once expired", async () => {
    const [userId] = await seedGuests(1, new Date(Date.now() - 1000));

    const reaped = await reapExpiredGuests();
    expect(reaped.sessionsReaped).toBeGreaterThanOrEqual(1);

    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId!));
    expect(users).toHaveLength(0);
    const slots = await db
      .select()
      .from(guestSessionsTable)
      .where(eq(guestSessionsTable.userId, userId!));
    expect(slots).toHaveLength(0);
  });

  it("deletes the workspace directory for a guest that created a project", async () => {
    const [userId] = await seedGuests(1, new Date(Date.now() - 1000));
    await db
      .update(guestSessionsTable)
      .set({ projectName: "GuestProj" })
      .where(eq(guestSessionsTable.userId, userId!));
    listAvailableProjectsMock.mockResolvedValue([
      { slnPath: "/ws/GuestProj/GuestProj.sln", solutionName: "GuestProj" },
    ]);

    const reaped = await reapExpiredGuests();
    expect(deleteProjectMock).toHaveBeenCalledWith(
      "/ws/GuestProj/GuestProj.sln",
    );
    expect(reaped.projectsDeleted).toBe(1);
    expect(reaped.sessionsReaped).toBeGreaterThanOrEqual(1);
  });

  it("still releases the slot when the project directory is already gone", async () => {
    const [userId] = await seedGuests(1, new Date(Date.now() - 1000));
    await db
      .update(guestSessionsTable)
      .set({ projectName: "VanishedProj" })
      .where(eq(guestSessionsTable.userId, userId!));
    listAvailableProjectsMock.mockResolvedValue([]);

    const reaped = await reapExpiredGuests();
    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(reaped.projectsDeleted).toBe(0);
    // The slot must still be freed, or a vanished project would pin a
    // slot against the cap forever.
    expect(reaped.sessionsReaped).toBeGreaterThanOrEqual(1);
  });

  it("keeps reaping the batch when one guest fails, and retries it next sweep", async () => {
    const [okId] = await seedGuests(1, new Date(Date.now() - 2000));
    const [badId] = await seedGuests(1, new Date(Date.now() - 1000));
    await db
      .update(guestSessionsTable)
      .set({ projectName: "BadProj" })
      .where(eq(guestSessionsTable.userId, badId!));
    listAvailableProjectsMock.mockResolvedValue([
      { slnPath: "/ws/BadProj/BadProj.sln", solutionName: "BadProj" },
    ]);
    deleteProjectMock.mockRejectedValueOnce(new Error("EBUSY"));

    const reaped = await reapExpiredGuests();
    // The healthy guest is gone...
    expect(reaped.sessionsReaped).toBe(1);
    expect(
      await db.select().from(usersTable).where(eq(usersTable.id, okId!)),
    ).toHaveLength(0);
    // ...and the failed one survives so the next sweep can retry it.
    expect(
      await db.select().from(usersTable).where(eq(usersTable.id, badId!)),
    ).toHaveLength(1);

    deleteProjectMock.mockResolvedValue(undefined);
    const second = await reapExpiredGuests();
    expect(second.sessionsReaped).toBe(1);
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/server/db/client";
import { clubMemberships, clubs } from "@/server/db/schema";
import { ConflictError, ForbiddenError } from "@/server/errors";
import {
  approveClub,
  archiveClub,
  getPublicClubBySlug,
  listClubsForActor,
  requestClub,
} from "@/server/services/clubs";

import {
  actorOf,
  auditActions,
  createClub,
  createUser,
  resetDatabase,
  settle,
} from "./helpers";

const input = {
  name: "Robotics Club",
  description: "We build robots and enter campus competitions.",
  logoUrl: null,
};

beforeEach(resetDatabase);
afterAll(() => pool.end());

describe("requestClub", () => {
  it("creates a pending club with no members yet", async () => {
    const student = await createUser();
    const club = await requestClub(await actorOf(student), input);

    expect(club).toMatchObject({
      slug: "robotics-club",
      status: "PENDING",
      createdBy: student.id,
      isTest: false,
    });
    expect(await db.select().from(clubMemberships)).toEqual([]);
    expect(await auditActions()).toEqual(["club.requested"]);
  });

  it("gives identical names different slugs, even at the same moment", async () => {
    const actor = await actorOf(await createUser());
    const created = await Promise.all(
      Array.from({ length: 5 }, () => requestClub(actor, input)),
    );
    expect(new Set(created.map((club) => club.slug)).size).toBe(5);
  });

  it("appears as pending for the requester", async () => {
    const actor = await actorOf(await createUser());
    const club = await requestClub(actor, input);
    expect(await listClubsForActor(actor)).toEqual({
      memberOf: [],
      pendingRequests: [{ id: club.id, name: club.name }],
    });
  });
});

describe("approveClub", () => {
  it("activates the club and makes the requester its owner", async () => {
    const student = await createUser();
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const club = await createClub(student, "PENDING");

    await approveClub(admin, club.id);

    const [row] = await db.select().from(clubs).where(eq(clubs.id, club.id));
    expect(row.status).toBe("ACTIVE");
    expect(await db.select().from(clubMemberships)).toMatchObject([
      { userId: student.id, clubId: club.id, role: "OWNER" },
    ]);
    expect(await auditActions()).toEqual(["club.approved"]);
  });

  it("is refused for anyone but a super admin and changes nothing", async () => {
    const student = await createUser();
    const club = await createClub(student, "PENDING");

    await expect(approveClub(await actorOf(student), club.id)).rejects.toThrow(
      ForbiddenError,
    );
    const [row] = await db.select().from(clubs).where(eq(clubs.id, club.id));
    expect(row.status).toBe("PENDING");
  });

  it("produces one owner when approved twice at once", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const club = await createClub(await createUser(), "PENDING");

    const { fulfilled, rejected } = await settle([
      approveClub(admin, club.id),
      approveClub(admin, club.id),
    ]);

    expect(fulfilled).toBe(1);
    expect(rejected[0]).toBeInstanceOf(ConflictError);
    expect(await db.select().from(clubMemberships)).toHaveLength(1);
    expect(await auditActions()).toEqual(["club.approved"]);
  });

  it("can't approve an archived club", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const club = await createClub(await createUser(), "ARCHIVED");
    await expect(approveClub(admin, club.id)).rejects.toThrow(ConflictError);
  });
});

describe("archiveClub", () => {
  it("archives an active club and logs it", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const club = await createClub(await createUser());

    expect((await archiveClub(admin, club.id)).status).toBe("ARCHIVED");
    expect(await auditActions()).toEqual(["club.archived"]);
  });

  it("is refused for the club's own owner", async () => {
    const owner = await createUser();
    const club = await createClub(owner);
    await expect(archiveClub(await actorOf(owner), club.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("getPublicClubBySlug", () => {
  it("returns active clubs and hides pending and archived ones", async () => {
    const owner = await createUser();
    const active = await createClub(owner);
    const pending = await createClub(owner, "PENDING");
    const archived = await createClub(owner, "ARCHIVED");

    expect((await getPublicClubBySlug(active.slug))?.id).toBe(active.id);
    expect(await getPublicClubBySlug(pending.slug)).toBeNull();
    expect(await getPublicClubBySlug(archived.slug)).toBeNull();
  });
});

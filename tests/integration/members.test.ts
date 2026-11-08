import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { clubInvites, clubMemberships } from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import {
  applyPendingInvites,
  changeMemberRole,
  inviteMember,
  listMembers,
  removeMember,
  revokeInvite,
} from "@/server/services/members";

import {
  actorOf,
  addMember,
  auditActions,
  createClub,
  createUser,
  closeConnections,
  resetDatabase,
  settle,
} from "./helpers";

const NEW_EMAIL = "new.person@nst.rishihood.edu.in";

async function ownedClub() {
  const owner = await createUser();
  const club = await createClub(owner);
  return { owner, club, actor: await actorOf(owner) };
}

async function roleOf(clubId: string, userId: string) {
  const [row] = await db
    .select()
    .from(clubMemberships)
    .where(
      and(
        eq(clubMemberships.clubId, clubId),
        eq(clubMemberships.userId, userId),
      ),
    );
  return row?.role ?? null;
}

async function ownerCount(clubId: string) {
  const rows = await db
    .select()
    .from(clubMemberships)
    .where(
      and(eq(clubMemberships.clubId, clubId), eq(clubMemberships.role, "OWNER")),
    );
  return rows.length;
}

beforeEach(resetDatabase);
afterAll(closeConnections);

describe("inviteMember", () => {
  it("adds someone with an account straight away", async () => {
    const { club, actor } = await ownedClub();
    const friend = await createUser("USER", NEW_EMAIL);

    const result = await inviteMember(actor, {
      clubId: club.id,
      email: NEW_EMAIL,
      role: "VOLUNTEER",
    });

    expect(result).toBe("added");
    expect(await roleOf(club.id, friend.id)).toBe("VOLUNTEER");
    expect(await db.select().from(clubInvites)).toEqual([]);
    expect(await auditActions()).toEqual(["member.added"]);
  });

  it("stores a pending invite for someone without an account", async () => {
    const { club, actor } = await ownedClub();

    const result = await inviteMember(actor, {
      clubId: club.id,
      email: NEW_EMAIL,
      role: "ADMIN",
    });

    expect(result).toBe("invited");
    expect(await db.select().from(clubInvites)).toMatchObject([
      { email: NEW_EMAIL, role: "ADMIN", acceptedAt: null },
    ]);
  });

  it("refuses an email that could never sign in", async () => {
    const { club, actor } = await ownedClub();
    await expect(
      inviteMember(actor, {
        clubId: club.id,
        email: "someone@gmail.com",
        role: "ADMIN",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a second pending invite for the same email", async () => {
    const { club, actor } = await ownedClub();
    const invite = { clubId: club.id, email: NEW_EMAIL, role: "ADMIN" as const };

    await inviteMember(actor, invite);
    await expect(inviteMember(actor, invite)).rejects.toThrow(ConflictError);
  });

  it("refuses someone already in the club", async () => {
    const { club, actor } = await ownedClub();
    await addMember(club.id, await createUser("USER", NEW_EMAIL), "VOLUNTEER");

    await expect(
      inviteMember(actor, { clubId: club.id, email: NEW_EMAIL, role: "ADMIN" }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses a club that isn't active", async () => {
    const owner = await createUser();
    const club = await createClub(owner, "ARCHIVED");
    await addMember(club.id, owner, "OWNER");

    await expect(
      inviteMember(await actorOf(owner), {
        clubId: club.id,
        email: NEW_EMAIL,
        role: "ADMIN",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it.each(["ADMIN", "VOLUNTEER"] as const)("is refused for a %s", async (role) => {
    const { club } = await ownedClub();
    const member = await createUser();
    await addMember(club.id, member, role);

    await expect(
      inviteMember(await actorOf(member), {
        clubId: club.id,
        email: NEW_EMAIL,
        role: "ADMIN",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("is refused for an owner of a different club", async () => {
    const { club } = await ownedClub();
    const { actor: otherOwner } = await ownedClub();

    await expect(
      inviteMember(otherOwner, {
        clubId: club.id,
        email: NEW_EMAIL,
        role: "OWNER",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listMembers", () => {
  it("is refused for a volunteer", async () => {
    const { club } = await ownedClub();
    const volunteer = await createUser();
    await addMember(club.id, volunteer, "VOLUNTEER");

    await expect(listMembers(await actorOf(volunteer), club.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("revokeInvite", () => {
  it("removes a pending invite and logs it", async () => {
    const { club, actor } = await ownedClub();
    await inviteMember(actor, {
      clubId: club.id,
      email: NEW_EMAIL,
      role: "ADMIN",
    });
    const [invite] = await db.select().from(clubInvites);

    await revokeInvite(actor, { clubId: club.id, inviteId: invite.id });

    expect(await db.select().from(clubInvites)).toEqual([]);
    expect(await auditActions()).toEqual(["invite.revoked", "member.invited"]);
  });

  it("can't reach another club's invite by naming your own club", async () => {
    const { club, actor } = await ownedClub();
    const { club: otherClub, actor: otherOwner } = await ownedClub();
    await inviteMember(actor, {
      clubId: club.id,
      email: NEW_EMAIL,
      role: "ADMIN",
    });
    const [invite] = await db.select().from(clubInvites);

    await expect(
      revokeInvite(otherOwner, { clubId: otherClub.id, inviteId: invite.id }),
    ).rejects.toThrow(NotFoundError);
    expect(await db.select().from(clubInvites)).toHaveLength(1);
  });
});

describe("changeMemberRole", () => {
  it("changes a role and records the before and after", async () => {
    const { club, actor } = await ownedClub();
    const member = await createUser();
    await addMember(club.id, member, "VOLUNTEER");

    await changeMemberRole(actor, {
      clubId: club.id,
      userId: member.id,
      role: "ADMIN",
    });

    expect(await roleOf(club.id, member.id)).toBe("ADMIN");
    expect(await auditActions()).toEqual(["member.role_changed"]);
  });

  it("blocks demoting the last owner", async () => {
    const { owner, club, actor } = await ownedClub();

    await expect(
      changeMemberRole(actor, {
        clubId: club.id,
        userId: owner.id,
        role: "ADMIN",
      }),
    ).rejects.toThrow(ConflictError);
    expect(await roleOf(club.id, owner.id)).toBe("OWNER");
  });

  it("allows demoting an owner when another remains", async () => {
    const { owner, club, actor } = await ownedClub();
    await addMember(club.id, await createUser(), "OWNER");

    await changeMemberRole(actor, {
      clubId: club.id,
      userId: owner.id,
      role: "ADMIN",
    });

    expect(await ownerCount(club.id)).toBe(1);
  });

  it("leaves one owner when two owners demote each other at once", async () => {
    const { owner, club, actor } = await ownedClub();
    const coOwner = await createUser();
    await addMember(club.id, coOwner, "OWNER");
    const coOwnerActor = await actorOf(coOwner);

    const { fulfilled, rejected } = await settle([
      changeMemberRole(actor, {
        clubId: club.id,
        userId: coOwner.id,
        role: "VOLUNTEER",
      }),
      changeMemberRole(coOwnerActor, {
        clubId: club.id,
        userId: owner.id,
        role: "VOLUNTEER",
      }),
    ]);

    expect(fulfilled).toBe(1);
    expect(rejected[0]).toBeInstanceOf(ConflictError);
    expect(await ownerCount(club.id)).toBe(1);
  });
});

describe("removeMember", () => {
  it("removes a member and logs it", async () => {
    const { club, actor } = await ownedClub();
    const member = await createUser();
    await addMember(club.id, member, "VOLUNTEER");

    await removeMember(actor, { clubId: club.id, userId: member.id });

    expect(await roleOf(club.id, member.id)).toBeNull();
    expect(await auditActions()).toEqual(["member.removed"]);
  });

  it("blocks removing the last owner, even by a super admin", async () => {
    const { owner, club } = await ownedClub();
    const admin = await actorOf(await createUser("SUPER_ADMIN"));

    await expect(
      removeMember(admin, { clubId: club.id, userId: owner.id }),
    ).rejects.toThrow(ConflictError);
    expect(await roleOf(club.id, owner.id)).toBe("OWNER");
  });

  it("leaves one owner when two owners remove each other at once", async () => {
    const { owner, club, actor } = await ownedClub();
    const coOwner = await createUser();
    await addMember(club.id, coOwner, "OWNER");
    const coOwnerActor = await actorOf(coOwner);

    const { fulfilled } = await settle([
      removeMember(actor, { clubId: club.id, userId: coOwner.id }),
      removeMember(coOwnerActor, { clubId: club.id, userId: owner.id }),
    ]);

    expect(fulfilled).toBe(1);
    expect(await ownerCount(club.id)).toBe(1);
  });

  it("reports someone who isn't in the club", async () => {
    const { club, actor } = await ownedClub();
    const stranger = await createUser();
    await expect(
      removeMember(actor, { clubId: club.id, userId: stranger.id }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("applyPendingInvites", () => {
  async function invited() {
    const { club, actor } = await ownedClub();
    await inviteMember(actor, {
      clubId: club.id,
      email: NEW_EMAIL,
      role: "ADMIN",
    });
    return club;
  }

  it("turns a pending invite into a membership", async () => {
    const club = await invited();
    const user = await createUser("USER", NEW_EMAIL);

    await applyPendingInvites(user.id);

    expect(await roleOf(club.id, user.id)).toBe("ADMIN");
    const [invite] = await db.select().from(clubInvites);
    expect(invite.acceptedAt).toBeInstanceOf(Date);
  });

  it("is safe to run repeatedly and concurrently", async () => {
    await invited();
    const user = await createUser("USER", NEW_EMAIL);

    await Promise.all([
      applyPendingInvites(user.id),
      applyPendingInvites(user.id),
      applyPendingInvites(user.id),
    ]);

    expect(await db.select().from(clubMemberships)).toHaveLength(2);
    const actions = await auditActions();
    expect(actions.filter((a) => a === "invite.accepted")).toHaveLength(1);
  });

  it("keeps an existing role instead of overwriting it", async () => {
    const club = await invited();
    const user = await createUser("USER", NEW_EMAIL);
    await addMember(club.id, user, "OWNER");

    await applyPendingInvites(user.id);

    expect(await roleOf(club.id, user.id)).toBe("OWNER");
  });

  it("ignores invites for other people", async () => {
    await invited();
    const someoneElse = await createUser();

    await applyPendingInvites(someoneElse.id);

    const [invite] = await db.select().from(clubInvites);
    expect(invite.acceptedAt).toBeNull();
  });
});

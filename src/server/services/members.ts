import { and, asc, count, eq, isNull } from "drizzle-orm";

import type {
  ChangeMemberRoleInput,
  InviteMemberInput,
  RemoveMemberInput,
  RevokeInviteInput,
} from "@/lib/validation";
import { allowedEmailDomains } from "@/server/auth/allowed-domains";
import { isAllowedEmail } from "@/server/auth/email-domain";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { clubInvites, clubMemberships, clubs, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

import { recordAudit, type Transaction } from "./audit";

const LAST_OWNER_MESSAGE =
  "A club needs at least one owner. Make someone else an owner first.";

/**
 * Locks the club row for the rest of the transaction, so changes to one
 * club's members run one at a time. Without it, two owners demoting each
 * other could each still see the other as an owner and leave the club with
 * none.
 */
async function lockActiveClub(tx: Transaction, clubId: string) {
  const [club] = await tx
    .select({ status: clubs.status })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .for("update");
  if (!club) throw new NotFoundError("That club no longer exists.");
  if (club.status !== "ACTIVE") {
    throw new ConflictError("Members can only be changed on an active club.");
  }
}

async function findMembership(tx: Transaction, clubId: string, userId: string) {
  const [membership] = await tx
    .select()
    .from(clubMemberships)
    .where(
      and(
        eq(clubMemberships.clubId, clubId),
        eq(clubMemberships.userId, userId),
      ),
    );
  if (!membership) throw new NotFoundError("That person isn't in this club.");
  return membership;
}

async function assertNotLastOwner(tx: Transaction, clubId: string) {
  const [owners] = await tx
    .select({ total: count() })
    .from(clubMemberships)
    .where(
      and(eq(clubMemberships.clubId, clubId), eq(clubMemberships.role, "OWNER")),
    );
  if (owners.total <= 1) throw new ConflictError(LAST_OWNER_MESSAGE);
}

export async function listMembers(actor: Actor, clubId: string) {
  assertCan(actor, "member.view", { clubId });

  const [members, pendingInvites] = await Promise.all([
    db
      .select({
        userId: clubMemberships.userId,
        role: clubMemberships.role,
        name: users.name,
        email: users.email,
      })
      .from(clubMemberships)
      .innerJoin(users, eq(users.id, clubMemberships.userId))
      .where(eq(clubMemberships.clubId, clubId))
      .orderBy(asc(users.name)),
    db
      .select({
        id: clubInvites.id,
        email: clubInvites.email,
        role: clubInvites.role,
      })
      .from(clubInvites)
      .where(
        and(eq(clubInvites.clubId, clubId), isNull(clubInvites.acceptedAt)),
      )
      .orderBy(asc(clubInvites.email)),
  ]);
  return { members, pendingInvites };
}

/**
 * Adds someone who already has an account straight away. Anyone else gets a
 * pending invite, applied when they next sign in.
 */
export async function inviteMember(
  actor: Actor,
  { clubId, email, role }: InviteMemberInput,
): Promise<"added" | "invited"> {
  assertCan(actor, "member.invite", { clubId });

  if (!isAllowedEmail(email, allowedEmailDomains)) {
    throw new ValidationError(
      "That email can't sign in to Turnout. Use a college email address.",
    );
  }

  return db.transaction(async (tx) => {
    await lockActiveClub(tx, clubId);

    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));

    if (existingUser) {
      const [membership] = await tx
        .insert(clubMemberships)
        .values({ userId: existingUser.id, clubId, role })
        .onConflictDoNothing()
        .returning();
      if (!membership) {
        throw new ConflictError("That person is already in this club.");
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: "member.added",
        entityType: "club_membership",
        entityId: `${clubId}:${existingUser.id}`,
        metadata: { clubId, email, role },
      });
      return "added";
    }

    const [invite] = await tx
      .insert(clubInvites)
      .values({ clubId, email, role, invitedBy: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!invite) {
      throw new ConflictError("That email already has a pending invite.");
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: "member.invited",
      entityType: "club_invite",
      entityId: invite.id,
      metadata: { clubId, email, role },
    });
    return "invited";
  });
}

export async function revokeInvite(
  actor: Actor,
  { clubId, inviteId }: RevokeInviteInput,
) {
  assertCan(actor, "member.invite", { clubId });

  await db.transaction(async (tx) => {
    // Scoped to clubId so an owner of one club can't revoke another's invite.
    const [invite] = await tx
      .delete(clubInvites)
      .where(
        and(
          eq(clubInvites.id, inviteId),
          eq(clubInvites.clubId, clubId),
          isNull(clubInvites.acceptedAt),
        ),
      )
      .returning();
    if (!invite) throw new NotFoundError("That invite is no longer pending.");

    await recordAudit(tx, {
      actorId: actor.id,
      action: "invite.revoked",
      entityType: "club_invite",
      entityId: invite.id,
      metadata: { clubId, email: invite.email, role: invite.role },
    });
  });
}

export async function changeMemberRole(
  actor: Actor,
  { clubId, userId, role }: ChangeMemberRoleInput,
) {
  assertCan(actor, "member.changeRole", { clubId });

  await db.transaction(async (tx) => {
    await lockActiveClub(tx, clubId);
    const membership = await findMembership(tx, clubId, userId);
    if (membership.role === role) return;

    if (membership.role === "OWNER") await assertNotLastOwner(tx, clubId);

    await tx
      .update(clubMemberships)
      .set({ role })
      .where(
        and(
          eq(clubMemberships.clubId, clubId),
          eq(clubMemberships.userId, userId),
        ),
      );
    await recordAudit(tx, {
      actorId: actor.id,
      action: "member.role_changed",
      entityType: "club_membership",
      entityId: `${clubId}:${userId}`,
      metadata: { clubId, userId, from: membership.role, to: role },
    });
  });
}

export async function removeMember(
  actor: Actor,
  { clubId, userId }: RemoveMemberInput,
) {
  assertCan(actor, "member.remove", { clubId });

  await db.transaction(async (tx) => {
    await lockActiveClub(tx, clubId);
    const membership = await findMembership(tx, clubId, userId);

    if (membership.role === "OWNER") await assertNotLastOwner(tx, clubId);

    await tx
      .delete(clubMemberships)
      .where(
        and(
          eq(clubMemberships.clubId, clubId),
          eq(clubMemberships.userId, userId),
        ),
      );
    await recordAudit(tx, {
      actorId: actor.id,
      action: "member.removed",
      entityType: "club_membership",
      entityId: `${clubId}:${userId}`,
      metadata: { clubId, userId, role: membership.role },
    });
  });
}

/** Runs at sign-in, for the signed-in user only, so it takes no actor. */
export async function applyPendingInvites(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return;

    const invites = await tx
      .select()
      .from(clubInvites)
      .where(
        and(eq(clubInvites.email, user.email), isNull(clubInvites.acceptedAt)),
      )
      .for("update");

    for (const invite of invites) {
      // If they already joined this club another way, keep that role.
      await tx
        .insert(clubMemberships)
        .values({ userId, clubId: invite.clubId, role: invite.role })
        .onConflictDoNothing();
      await tx
        .update(clubInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(clubInvites.id, invite.id));
      await recordAudit(tx, {
        actorId: userId,
        action: "invite.accepted",
        entityType: "club_invite",
        entityId: invite.id,
        metadata: { clubId: invite.clubId, role: invite.role },
      });
    }
  });
}

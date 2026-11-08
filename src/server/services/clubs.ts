import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, ne } from "drizzle-orm";

import { slugify } from "@/lib/slug";
import type { RequestClubInput } from "@/lib/validation";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { clubMemberships, clubs, users } from "@/server/db/schema";
import { ConflictError } from "@/server/errors";

import { recordAudit } from "./audit";

const SLUG_ATTEMPTS = 5;

export async function requestClub(actor: Actor, input: RequestClubInput) {
  assertCan(actor, "club.request");

  const baseSlug = slugify(input.name, "club");
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug =
      attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(3).toString("hex")}`;

    // Letting the unique index decide means two identical requests can't
    // both claim a slug, which a check-then-insert would allow.
    const [club] = await db
      .insert(clubs)
      .values({ ...input, slug, createdBy: actor.id })
      .onConflictDoNothing({ target: clubs.slug })
      .returning();

    if (club) {
      await recordAudit(db, {
        actorId: actor.id,
        action: "club.requested",
        entityType: "club",
        entityId: club.id,
        metadata: { name: club.name },
      });
      return club;
    }
  }
  throw new ConflictError("Couldn't save that club name. Try a different one.");
}

export async function approveClub(actor: Actor, clubId: string) {
  assertCan(actor, "club.approve");

  return db.transaction(async (tx) => {
    // The status condition makes a double approval a no-op for the loser.
    const [club] = await tx
      .update(clubs)
      .set({ status: "ACTIVE" })
      .where(and(eq(clubs.id, clubId), eq(clubs.status, "PENDING")))
      .returning();
    if (!club) throw new ConflictError("This club isn't awaiting approval.");

    await tx
      .insert(clubMemberships)
      .values({ userId: club.createdBy, clubId: club.id, role: "OWNER" });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "club.approved",
      entityType: "club",
      entityId: club.id,
      metadata: { name: club.name, ownerId: club.createdBy },
    });
    return club;
  });
}

export async function archiveClub(actor: Actor, clubId: string) {
  assertCan(actor, "club.archive");

  return db.transaction(async (tx) => {
    const [club] = await tx
      .update(clubs)
      .set({ status: "ARCHIVED" })
      .where(and(eq(clubs.id, clubId), ne(clubs.status, "ARCHIVED")))
      .returning();
    if (!club) throw new ConflictError("This club is already archived.");

    await recordAudit(tx, {
      actorId: actor.id,
      action: "club.archived",
      entityType: "club",
      entityId: club.id,
      metadata: { name: club.name },
    });
    return club;
  });
}

/** Public data, so this needs no actor. Only approved clubs are visible. */
export async function getPublicClubBySlug(slug: string) {
  const [club] = await db
    .select()
    .from(clubs)
    .where(and(eq(clubs.slug, slug), eq(clubs.status, "ACTIVE")));
  return club ?? null;
}

export async function getClubBySlug(slug: string) {
  const [club] = await db.select().from(clubs).where(eq(clubs.slug, slug));
  return club ?? null;
}

/** The clubs an actor belongs to, and the requests still awaiting approval. */
export async function listClubsForActor(actor: Actor) {
  const [memberOf, pendingRequests] = await Promise.all([
    db
      .select({
        id: clubs.id,
        slug: clubs.slug,
        name: clubs.name,
        role: clubMemberships.role,
      })
      .from(clubMemberships)
      .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
      .where(
        and(eq(clubMemberships.userId, actor.id), eq(clubs.status, "ACTIVE")),
      )
      .orderBy(asc(clubs.name)),
    db
      .select({ id: clubs.id, name: clubs.name })
      .from(clubs)
      .where(and(eq(clubs.createdBy, actor.id), eq(clubs.status, "PENDING")))
      .orderBy(desc(clubs.createdAt)),
  ]);
  return { memberOf, pendingRequests };
}

export async function listClubsForAdmin(actor: Actor) {
  assertCan(actor, "club.approve");

  return db
    .select({
      id: clubs.id,
      slug: clubs.slug,
      name: clubs.name,
      description: clubs.description,
      status: clubs.status,
      requesterEmail: users.email,
      createdAt: clubs.createdAt,
    })
    .from(clubs)
    .innerJoin(users, eq(users.id, clubs.createdBy))
    .orderBy(desc(clubs.createdAt));
}

import { randomUUID } from "node:crypto";

import { loadActor } from "@/server/auth/actor";
import type { ClubRole } from "@/server/auth/permissions";
import { db, pool } from "@/server/db/client";
import { auditLogs, clubMemberships, clubs, users } from "@/server/db/schema";

export async function resetDatabase() {
  await pool.query(
    "TRUNCATE users, sessions, accounts, verifications, clubs, club_memberships, club_invites, audit_logs RESTART IDENTITY CASCADE",
  );
}

export async function createUser(
  platformRole: "USER" | "SUPER_ADMIN" = "USER",
  email = `${randomUUID()}@nst.rishihood.edu.in`,
) {
  const [user] = await db
    .insert(users)
    .values({ email, name: email, emailVerified: true, platformRole })
    .returning();
  return user;
}

export async function actorOf(user: { id: string }) {
  const actor = await loadActor(user.id);
  if (!actor) throw new Error("Test user not found");
  return actor;
}

export async function createClub(
  owner: { id: string },
  status: "PENDING" | "ACTIVE" | "ARCHIVED" = "ACTIVE",
) {
  const id = randomUUID();
  const [club] = await db
    .insert(clubs)
    .values({
      id,
      slug: `club-${id}`,
      name: "Test Club",
      description: "A club that only exists for tests.",
      status,
      createdBy: owner.id,
    })
    .returning();
  if (status === "ACTIVE") await addMember(club.id, owner, "OWNER");
  return club;
}

export async function addMember(
  clubId: string,
  user: { id: string },
  role: ClubRole,
) {
  await db.insert(clubMemberships).values({ clubId, userId: user.id, role });
}

export async function auditActions() {
  const rows = await db.select().from(auditLogs);
  return rows.map((row) => row.action).sort();
}

/** Runs promises together and reports how many succeeded and failed. */
export async function settle(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  return {
    fulfilled: results.filter((r) => r.status === "fulfilled").length,
    rejected: results
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason),
  };
}

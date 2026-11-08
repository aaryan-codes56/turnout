import { randomUUID } from "node:crypto";

import { loadActor } from "@/server/auth/actor";
import type { ClubRole } from "@/server/auth/permissions";
import { db, pool } from "@/server/db/client";
import {
  auditLogs,
  clubMemberships,
  clubs,
  events,
  registrations,
  users,
} from "@/server/db/schema";
import type { JobName } from "@/server/jobs/definitions";
import { getBoss } from "@/server/jobs/queue";

export async function resetDatabase() {
  await pool.query(
    "TRUNCATE users, sessions, accounts, verifications, clubs, club_memberships, club_invites, audit_logs, events, registrations, payments, webhook_events, metrics_snapshots, sent_emails, rate_limits RESTART IDENTITY CASCADE",
  );
  await pool.query("DELETE FROM pgboss.job");
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

const HOUR = 60 * 60 * 1000;

export async function createEvent(
  clubId: string,
  overrides: Partial<typeof events.$inferInsert> = {},
) {
  const id = randomUUID();
  const now = Date.now();
  const [event] = await db
    .insert(events)
    .values({
      id,
      clubId,
      slug: `event-${id}`,
      title: "Test Event",
      descriptionMd: "An event that only exists for tests.",
      venue: "Main Hall",
      startsAt: new Date(now + HOUR),
      endsAt: new Date(now + 3 * HOUR),
      capacity: 100,
      status: "PUBLISHED",
      registrationOpensAt: new Date(now - HOUR),
      registrationClosesAt: new Date(now + HOUR),
      ...overrides,
    })
    .returning();
  return event;
}

export async function createRegistration(
  eventId: string,
  user: { id: string },
  overrides: Partial<typeof registrations.$inferInsert> = {},
) {
  const [registration] = await db
    .insert(registrations)
    .values({ eventId, userId: user.id, status: "CONFIRMED", ...overrides })
    .returning();
  return registration;
}

export async function jobs(name: JobName) {
  const { rows } = await pool.query(
    "SELECT id, data, start_after FROM pgboss.job WHERE name = $1",
    [name],
  );
  return rows as { id: string; data: Record<string, unknown>; start_after: Date }[];
}

export async function closeConnections() {
  await (await getBoss()).stop({ graceful: false });
  await pool.end();
}

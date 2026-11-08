import { and, asc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { CustomQuestion, RegistrationAnswers } from "@/lib/event-questions";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { events, registrations, users } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { verifyQrPayload } from "@/server/tickets/qr-token";

import { recordAudit } from "./audit";
import { assertValidEventId } from "./events";

type Attendee = {
  name: string;
  rollNumber: string | null;
  email: string;
  notes: { label: string; value: string }[];
};

export type CheckinResult =
  | { code: "OK"; attendee: Attendee }
  | {
      code: "ALREADY_CHECKED_IN";
      attendee: Attendee;
      checkedInAt: string;
      checkedInBy: string | null;
    }
  | { code: "WRONG_EVENT" | "INVALID" | "NOT_CONFIRMED" | "OUTSIDE_WINDOW" };

type ScanEvent = Pick<
  typeof events.$inferSelect,
  | "id"
  | "clubId"
  | "status"
  | "startsAt"
  | "endsAt"
  | "checkinOpensBeforeMinutes"
  | "customQuestions"
>;

async function loadEvent(eventId: string): Promise<ScanEvent> {
  assertValidEventId(eventId);
  const [event] = await db
    .select({
      id: events.id,
      clubId: events.clubId,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      checkinOpensBeforeMinutes: events.checkinOpensBeforeMinutes,
      customQuestions: events.customQuestions,
    })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event) throw new NotFoundError("That event no longer exists.");
  return event;
}

export function isCheckinOpen(event: ScanEvent, now = new Date()): boolean {
  const opensAt = event.startsAt.getTime() - event.checkinOpensBeforeMinutes * 60_000;
  return (
    event.status === "PUBLISHED" &&
    now.getTime() >= opensAt &&
    now.getTime() <= event.endsAt.getTime()
  );
}

function toNotes(questions: CustomQuestion[], answers: RegistrationAnswers) {
  return questions.flatMap((question) => {
    const value = answers[question.id];
    if (value === undefined || value === false || value === "") return [];
    return [{ label: question.label, value: value === true ? "Yes" : String(value) }];
  });
}

const checkedInByUsers = alias(users, "checked_in_by_user");

async function performCheckIn(
  actor: Actor,
  event: ScanEvent,
  registrationId: string,
  method: "qr" | "manual",
): Promise<CheckinResult> {
  if (!isCheckinOpen(event)) return { code: "OUTSIDE_WINDOW" };

  // One atomic statement decides the winner. Two phones scanning the same
  // ticket can't both get OK, because only one UPDATE finds checked_in_at NULL.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(registrations)
      .set({ checkedInAt: new Date(), checkedInBy: actor.id })
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.eventId, event.id),
          isNull(registrations.checkedInAt),
          eq(registrations.status, "CONFIRMED"),
        ),
      )
      .returning({ id: registrations.id });
    if (rows.length > 0) {
      await recordAudit(tx, {
        actorId: actor.id,
        action: method === "manual" ? "checkin.manual" : "checkin.qr",
        entityType: "registration",
        entityId: registrationId,
        metadata: { eventId: event.id },
      });
    }
    return rows;
  });

  // Whether it worked or not, the door needs to know who this ticket belongs to.
  const [row] = await db
    .select({
      eventId: registrations.eventId,
      status: registrations.status,
      answers: registrations.answers,
      checkedInAt: registrations.checkedInAt,
      name: users.name,
      email: users.email,
      rollNumber: users.rollNumber,
      checkedInByName: checkedInByUsers.name,
    })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .leftJoin(checkedInByUsers, eq(checkedInByUsers.id, registrations.checkedInBy))
    .where(eq(registrations.id, registrationId));

  if (!row) return { code: "INVALID" };
  if (row.eventId !== event.id) return { code: "WRONG_EVENT" };

  const attendee: Attendee = {
    name: row.name,
    email: row.email,
    rollNumber: row.rollNumber,
    notes: toNotes(event.customQuestions, row.answers),
  };

  if (updated) return { code: "OK", attendee };
  if (row.checkedInAt) {
    return {
      code: "ALREADY_CHECKED_IN",
      attendee,
      checkedInAt: row.checkedInAt.toISOString(),
      checkedInBy: row.checkedInByName,
    };
  }
  return { code: "NOT_CONFIRMED" };
}

export async function checkInWithQr(
  actor: Actor,
  eventId: string,
  payload: string,
): Promise<CheckinResult> {
  const event = await loadEvent(eventId);
  assertCan(actor, "checkin.perform", { clubId: event.clubId });

  const registrationId = verifyQrPayload(payload);
  if (!registrationId) return { code: "INVALID" };
  return performCheckIn(actor, event, registrationId, "qr");
}

export async function checkInManually(
  actor: Actor,
  eventId: string,
  registrationId: string,
): Promise<CheckinResult> {
  const event = await loadEvent(eventId);
  assertCan(actor, "checkin.perform", { clubId: event.clubId });
  return performCheckIn(actor, event, registrationId, "manual");
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/** Only what a volunteer needs at the door, not the full attendee record. */
export async function searchForCheckin(
  actor: Actor,
  eventId: string,
  query: string,
) {
  const event = await loadEvent(eventId);
  assertCan(actor, "checkin.perform", { clubId: event.clubId });
  if (query.length < 2) return [];

  const pattern = `%${escapeLike(query)}%`;
  return db
    .select({
      registrationId: registrations.id,
      name: users.name,
      email: users.email,
      rollNumber: users.rollNumber,
      checkedInAt: registrations.checkedInAt,
    })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          ilike(users.rollNumber, pattern),
        ),
      ),
    )
    .orderBy(asc(users.name))
    .limit(20);
}

export async function getCheckinCounts(actor: Actor, eventId: string) {
  const event = await loadEvent(eventId);
  assertCan(actor, "checkin.perform", { clubId: event.clubId });

  const [counts] = await db
    .select({
      confirmed: sql<number>`count(*)::int`,
      checkedIn: sql<number>`count(${registrations.checkedInAt})::int`,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        or(
          eq(registrations.status, "CONFIRMED"),
          isNotNull(registrations.checkedInAt),
        ),
      ),
    );
  return counts;
}

export async function getScanPageEvent(actor: Actor, eventId: string) {
  const event = await loadEvent(eventId);
  assertCan(actor, "checkin.perform", { clubId: event.clubId });
  const [details] = await db
    .select({ title: events.title })
    .from(events)
    .where(eq(events.id, eventId));
  return { ...details, isOpen: isCheckinOpen(event) };
}

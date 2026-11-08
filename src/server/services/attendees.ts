import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";

import { toCsv } from "@/lib/csv";
import type { RegistrationAnswers } from "@/lib/event-questions";
import { formatDateTime } from "@/lib/time";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { payments, registrations, users } from "@/server/db/schema";

import { getEventById } from "./events";

type RegistrationStatus = (typeof registrations.$inferSelect)["status"];

type AttendeeFilter = { query?: string; status?: RegistrationStatus };

function selectAttendees(eventId: string, filter: AttendeeFilter) {
  const conditions: (SQL | undefined)[] = [eq(registrations.eventId, eventId)];
  if (filter.status) conditions.push(eq(registrations.status, filter.status));
  if (filter.query) {
    const pattern = `%${filter.query.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      or(
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        ilike(users.rollNumber, pattern),
      ),
    );
  }

  return db
    .select({
      registrationId: registrations.id,
      status: registrations.status,
      answers: registrations.answers,
      registeredAt: registrations.createdAt,
      checkedInAt: registrations.checkedInAt,
      name: users.name,
      email: users.email,
      rollNumber: users.rollNumber,
      paymentStatus: payments.status,
    })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(and(...conditions))
    .orderBy(asc(users.name));
}

export async function listAttendees(
  actor: Actor,
  eventId: string,
  filter: AttendeeFilter,
) {
  const event = await getEventById(eventId);
  assertCan(actor, "attendee.list", { clubId: event.clubId });
  return selectAttendees(eventId, filter);
}

function answerText(value: string | boolean | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

export async function exportAttendeesCsv(
  actor: Actor,
  eventId: string,
): Promise<{ filename: string; csv: string }> {
  const event = await getEventById(eventId);
  assertCan(actor, "attendee.export", { clubId: event.clubId });

  const rows = await selectAttendees(eventId, {});
  const header = [
    "Name",
    "Email",
    "Roll number",
    "Status",
    "Registered at",
    "Checked in at",
    ...event.customQuestions.map((question) => question.label),
  ];
  const body = rows.map((row) => {
    const answers: RegistrationAnswers = row.answers;
    return [
      row.name,
      row.email,
      row.rollNumber ?? "",
      row.status,
      formatDateTime(row.registeredAt),
      row.checkedInAt ? formatDateTime(row.checkedInAt) : "",
      ...event.customQuestions.map((question) => answerText(answers[question.id])),
    ];
  });

  return { filename: `${event.slug}-attendees.csv`, csv: toCsv([header, ...body]) };
}

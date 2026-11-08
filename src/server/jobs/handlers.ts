import { and, eq, inArray, lt, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { createElement } from "react";

import { env } from "@/lib/env";
import { buildIcs } from "@/lib/ics";
import { formatEventTime, formatPrice } from "@/lib/time";
import { db } from "@/server/db/client";
import { clubMemberships, events, registrations, users } from "@/server/db/schema";
import { sendEmailOnce } from "@/server/email/send";
import {
  CancellationEmail,
  RefundEmail,
  ReminderEmail,
  SummaryEmail,
  TicketEmail,
} from "@/server/email/templates";
import { logger } from "@/server/logger";
import { deleteOldRateLimits } from "@/server/rate-limit";
import { writeMetricsSnapshot } from "@/server/services/metrics";
import {
  executeRefund,
  expireHoldsAndReconcile,
} from "@/server/services/payments";
import { createQrPayload } from "@/server/tickets/qr-token";

import { JOBS, type JobName, type JobPayloads } from "./definitions";

function eventDetails(event: typeof events.$inferSelect) {
  return {
    title: event.title,
    when: formatEventTime(event.startsAt, event.endsAt),
    venue: event.venue,
    url: `${env.APP_URL}/e/${event.slug}`,
  };
}

async function loadRegistration(registrationId: string) {
  const [row] = await db
    .select({ registration: registrations, event: events, user: users })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(eq(registrations.id, registrationId));
  return row ?? null;
}

async function sendTicketEmail({ registrationId }: JobPayloads["send-ticket-email"]) {
  const row = await loadRegistration(registrationId);
  // They may have cancelled between confirming and this job running.
  if (row?.registration.status !== "CONFIRMED") return;
  const { event, user } = row;

  const qrImage = await QRCode.toBuffer(createQrPayload(registrationId), {
    width: 560,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  const calendar = buildIcs({
    id: event.id,
    title: event.title,
    description: event.descriptionMd,
    venue: event.venue,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    url: `${env.APP_URL}/e/${event.slug}`,
  });

  await sendEmailOnce(`ticket:${registrationId}`, {
    to: user.email,
    subject: `Your ticket: ${event.title}`,
    body: createElement(TicketEmail, { ...eventDetails(event), name: user.name }),
    attachments: [
      { filename: "ticket.png", content: qrImage, contentType: "image/png", cid: "ticket-qr" },
      { filename: "event.ics", content: calendar, contentType: "text/calendar" },
    ],
  });
}

async function sendCancellationNotice({
  registrationId,
}: JobPayloads["send-cancellation-notice"]) {
  const row = await loadRegistration(registrationId);
  if (!row) return;
  await sendEmailOnce(`cancelled:${registrationId}`, {
    to: row.user.email,
    subject: `Cancelled: ${row.event.title}`,
    body: createElement(CancellationEmail, {
      ...eventDetails(row.event),
      refunded: row.event.pricePaise > 0,
    }),
  });
}

async function eventReminder({
  eventId,
  kind,
  startsAt,
}: JobPayloads["event-reminder"]) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  // A time change queues new reminders, so this one is out of date.
  if (event?.status !== "PUBLISHED") return;
  if (event.startsAt.toISOString() !== startsAt) return;

  const attendees = await db
    .select({ registrationId: registrations.id, email: users.email })
    .from(registrations)
    .innerJoin(users, eq(users.id, registrations.userId))
    .where(
      and(eq(registrations.eventId, eventId), eq(registrations.status, "CONFIRMED")),
    );

  for (const { registrationId, email } of attendees) {
    await sendEmailOnce(`reminder:${kind}:${startsAt}:${registrationId}`, {
      to: email,
      subject: `Reminder: ${event.title}`,
      body: createElement(ReminderEmail, {
        ...eventDetails(event),
        startsIn: kind === "24h" ? "24 hours" : "2 hours",
      }),
    });
  }
}

async function refundRegistration({
  registrationId,
  reason,
}: JobPayloads["refund-registration"]) {
  const refunded = await executeRefund(registrationId);
  // Event cancellations already told people a refund is coming.
  if (!refunded || reason === "event_cancelled") return;

  const row = await loadRegistration(registrationId);
  if (!row) return;
  await sendEmailOnce(`refund:${registrationId}`, {
    to: row.user.email,
    subject: `Refund: ${row.event.title}`,
    body: createElement(RefundEmail, {
      ...eventDetails(row.event),
      amount: formatPrice(row.event.pricePaise),
      reason:
        reason === "late_payment"
          ? "Your payment arrived after your seat hold ended and the event had filled up."
          : "The club issued this refund.",
    }),
  });
}

async function postEventSummary({
  eventId,
  endsAt,
}: JobPayloads["post-event-summary"]) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event || event.status === "CANCELLED") return;
  if (event.endsAt.toISOString() !== endsAt) return;

  const [counts] = await db
    .select({
      confirmed: sql<number>`count(*)::int`,
      checkedIn: sql<number>`count(${registrations.checkedInAt})::int`,
    })
    .from(registrations)
    .where(
      and(eq(registrations.eventId, eventId), eq(registrations.status, "CONFIRMED")),
    );

  const noShows = counts.confirmed - counts.checkedIn;
  const noShowRate =
    counts.confirmed === 0
      ? "n/a"
      : `${Math.round((noShows / counts.confirmed) * 100)}%`;

  const recipients = await db
    .select({ email: users.email })
    .from(clubMemberships)
    .innerJoin(users, eq(users.id, clubMemberships.userId))
    .where(
      and(
        eq(clubMemberships.clubId, event.clubId),
        inArray(clubMemberships.role, ["OWNER", "ADMIN"]),
      ),
    );

  for (const { email } of recipients) {
    await sendEmailOnce(`summary:${eventId}:${endsAt}:${email}`, {
      to: email,
      subject: `How it went: ${event.title}`,
      body: createElement(SummaryEmail, {
        ...eventDetails(event),
        confirmed: counts.confirmed,
        checkedIn: counts.checkedIn,
        noShowRate,
      }),
    });
  }
}

async function completeEndedEvents() {
  await db
    .update(events)
    .set({ status: "COMPLETED" })
    .where(and(eq(events.status, "PUBLISHED"), lt(events.endsAt, new Date())));
}

async function metricsSnapshot() {
  await writeMetricsSnapshot();
  await deleteOldRateLimits();
}

async function reconcile() {
  const result = await expireHoldsAndReconcile();
  if (result.confirmed || result.expired) logger.info(result, "Reconciled holds");
}

export const handlers: {
  [N in JobName]: (data: JobPayloads[N]) => Promise<void>;
} = {
  [JOBS.sendTicketEmail]: sendTicketEmail,
  [JOBS.sendCancellationNotice]: sendCancellationNotice,
  [JOBS.eventReminder]: eventReminder,
  [JOBS.expireHoldsAndReconcile]: reconcile,
  [JOBS.refundRegistration]: refundRegistration,
  [JOBS.postEventSummary]: postEventSummary,
  [JOBS.metricsSnapshot]: metricsSnapshot,
  [JOBS.completeEndedEvents]: completeEndedEvents,
};

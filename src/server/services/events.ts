import { randomBytes } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { slugify } from "@/lib/slug";
import type { EventFormInput } from "@/lib/validation";
import { type Actor, assertCan, can } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { clubs, events, payments, registrations } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { enqueue } from "@/server/jobs/queue";
import { paymentsConfigured } from "@/server/payments/razorpay";

import { recordAudit, type Transaction } from "./audit";

const HOUR = 60 * 60 * 1000;
const SLUG_ATTEMPTS = 5;

type EventRow = typeof events.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A garbled id in a URL is a missing page, not a database error. */
export function assertValidEventId(eventId: string): void {
  if (!UUID.test(eventId)) throw new NotFoundError("That event no longer exists.");
}

export async function getEventById(eventId: string): Promise<EventRow> {
  assertValidEventId(eventId);
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new NotFoundError("That event no longer exists.");
  return event;
}

function assertPriceAllowed(pricePaise: number) {
  if (pricePaise > 0 && !paymentsConfigured()) {
    throw new ValidationError(
      "Paid events need Razorpay keys. Set the price to 0 for now.",
    );
  }
}

export async function createEvent(
  actor: Actor,
  clubId: string,
  input: EventFormInput,
): Promise<EventRow> {
  assertCan(actor, "event.create", { clubId });
  assertPriceAllowed(input.pricePaise);

  const [club] = await db
    .select({ status: clubs.status, isTest: clubs.isTest })
    .from(clubs)
    .where(eq(clubs.id, clubId));
  if (club?.status !== "ACTIVE") {
    throw new ConflictError("Events can only be added to an active club.");
  }

  const baseSlug = slugify(input.title, "event");
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const [event] = await db
      .insert(events)
      .values({
        ...input,
        clubId,
        isTest: club.isTest,
        slug: `${baseSlug}-${randomBytes(3).toString("hex")}`,
        registrationOpensAt: input.registrationOpensAt ?? new Date(),
        registrationClosesAt: input.registrationClosesAt ?? input.startsAt,
      })
      .onConflictDoNothing({ target: events.slug })
      .returning();
    if (event) return event;
  }
  throw new ConflictError("Couldn't save that title. Try a different one.");
}

/**
 * Queues reminders and the post-event summary. The start or end time is part
 * of each job's key and payload, so a time change creates fresh jobs and the
 * old ones see they're out of date and do nothing when they run.
 */
async function scheduleEventJobs(tx: Transaction, event: EventRow) {
  const now = Date.now();
  const startsAt = event.startsAt.toISOString();
  const endsAt = event.endsAt.toISOString();

  const reminders = [
    { kind: "24h", offset: 24 * HOUR },
    { kind: "2h", offset: 2 * HOUR },
  ] as const;
  for (const { kind, offset } of reminders) {
    const runAt = new Date(event.startsAt.getTime() - offset);
    if (runAt.getTime() <= now) continue;
    await enqueue(
      tx,
      JOBS.eventReminder,
      { eventId: event.id, kind, startsAt },
      { key: `${event.id}:${kind}:${startsAt}`, startAfter: runAt },
    );
  }

  await enqueue(
    tx,
    JOBS.postEventSummary,
    { eventId: event.id, endsAt },
    {
      key: `${event.id}:${endsAt}`,
      startAfter: new Date(event.endsAt.getTime() + 2 * HOUR),
    },
  );
}

export async function updateEvent(
  actor: Actor,
  eventId: string,
  input: EventFormInput,
): Promise<EventRow> {
  const existing = await getEventById(eventId);
  assertCan(actor, "event.edit", { clubId: existing.clubId });
  assertPriceAllowed(input.pricePaise);

  if (existing.status !== "DRAFT" && existing.status !== "PUBLISHED") {
    throw new ConflictError("Finished or cancelled events can't be edited.");
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");

    if (locked.seatsTaken > input.capacity) {
      throw new ConflictError(
        `${locked.seatsTaken} seats are already taken, so capacity can't go below that.`,
      );
    }
    if (locked.seatsTaken > 0 && locked.pricePaise !== input.pricePaise) {
      throw new ConflictError(
        "The price can't change once people have registered.",
      );
    }

    const [updated] = await tx
      .update(events)
      .set({
        ...input,
        registrationOpensAt: input.registrationOpensAt ?? locked.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt ?? input.startsAt,
      })
      .where(eq(events.id, eventId))
      .returning();

    const timeChanged =
      updated.startsAt.getTime() !== locked.startsAt.getTime() ||
      updated.endsAt.getTime() !== locked.endsAt.getTime();
    if (updated.status === "PUBLISHED" && timeChanged) {
      await scheduleEventJobs(tx, updated);
      await recordAudit(tx, {
        actorId: actor.id,
        action: "event.rescheduled",
        entityType: "event",
        entityId: eventId,
        metadata: {
          from: locked.startsAt.toISOString(),
          to: updated.startsAt.toISOString(),
        },
      });
    }
    return updated;
  });
}

export async function publishEvent(actor: Actor, eventId: string) {
  const existing = await getEventById(eventId);
  assertCan(actor, "event.publish", { clubId: existing.clubId });

  return db.transaction(async (tx) => {
    const [event] = await tx
      .update(events)
      .set({ status: "PUBLISHED" })
      .where(and(eq(events.id, eventId), eq(events.status, "DRAFT")))
      .returning();
    if (!event) throw new ConflictError("Only a draft can be published.");

    await scheduleEventJobs(tx, event);
    await recordAudit(tx, {
      actorId: actor.id,
      action: "event.published",
      entityType: "event",
      entityId: eventId,
      metadata: { title: event.title },
    });
    return event;
  });
}

export async function cancelEvent(actor: Actor, eventId: string) {
  const existing = await getEventById(eventId);
  assertCan(actor, "event.cancel", { clubId: existing.clubId });

  return db.transaction(async (tx) => {
    const [event] = await tx
      .update(events)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(events.id, eventId),
          inArray(events.status, ["DRAFT", "PUBLISHED"]),
        ),
      )
      .returning();
    if (!event) throw new ConflictError("This event can't be cancelled now.");

    const confirmed = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          eq(registrations.status, "CONFIRMED"),
        ),
      );

    for (const { id } of confirmed) {
      await enqueue(tx, JOBS.sendCancellationNotice, { registrationId: id }, { key: id });
      if (event.pricePaise > 0) {
        await enqueue(
          tx,
          JOBS.refundRegistration,
          { registrationId: id, reason: "event_cancelled" },
          { key: id },
        );
      }
    }

    if (event.pricePaise === 0 && confirmed.length > 0) {
      await tx
        .update(registrations)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(registrations.eventId, eventId),
            eq(registrations.status, "CONFIRMED"),
          ),
        );
      await tx
        .update(events)
        .set({ seatsTaken: sql`${events.seatsTaken} - ${confirmed.length}` })
        .where(eq(events.id, eventId));
    }

    await recordAudit(tx, {
      actorId: actor.id,
      action: "event.cancelled",
      entityType: "event",
      entityId: eventId,
      metadata: { title: event.title, registrations: confirmed.length },
    });
    return event;
  });
}

export async function setEventTestFlag(
  actor: Actor,
  eventId: string,
  isTest: boolean,
) {
  assertCan(actor, "event.markTest");
  await db.transaction(async (tx) => {
    const [event] = await tx
      .update(events)
      .set({ isTest })
      .where(eq(events.id, eventId))
      .returning({ id: events.id });
    if (!event) throw new NotFoundError("That event no longer exists.");
    await recordAudit(tx, {
      actorId: actor.id,
      action: isTest ? "event.marked_test" : "event.marked_real",
      entityType: "event",
      entityId: eventId,
    });
  });
}

/** Public: drafts stay hidden, and so do events from unapproved clubs. */
export async function getPublicEventBySlug(slug: string) {
  const [row] = await db
    .select({ event: events, clubName: clubs.name, clubSlug: clubs.slug })
    .from(events)
    .innerJoin(clubs, eq(clubs.id, events.clubId))
    .where(
      and(
        eq(events.slug, slug),
        inArray(events.status, ["PUBLISHED", "COMPLETED", "CANCELLED"]),
        eq(clubs.status, "ACTIVE"),
      ),
    );
  return row ?? null;
}

/** The home page's list of what's coming up across all clubs. */
export async function listUpcomingEvents() {
  return db
    .select({
      slug: events.slug,
      title: events.title,
      venue: events.venue,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      pricePaise: events.pricePaise,
      clubName: clubs.name,
    })
    .from(events)
    .innerJoin(clubs, eq(clubs.id, events.clubId))
    .where(
      and(
        eq(events.status, "PUBLISHED"),
        eq(clubs.status, "ACTIVE"),
        gte(events.endsAt, new Date()),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(20);
}

/** Public events for a club page, with the soonest upcoming event first. */
export async function listPublicClubEvents(clubId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.clubId, clubId),
        inArray(events.status, ["PUBLISHED", "COMPLETED"]),
      ),
    )
    .orderBy(asc(events.startsAt));
  const now = Date.now();
  return {
    upcoming: rows.filter((event) => event.endsAt.getTime() >= now),
    past: rows.filter((event) => event.endsAt.getTime() < now).reverse(),
  };
}

export async function listDashboardEvents(actor: Actor, clubId: string) {
  assertCan(actor, "club.viewDashboard", { clubId });
  const showNumbers = can(actor, "attendee.list", { clubId });

  const rows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      capacity: events.capacity,
      registrations: sql<number>`(
        SELECT count(*)::int FROM ${registrations} r
        WHERE r.event_id = "events"."id" AND r.status = 'CONFIRMED'
      )`,
      checkins: sql<number>`(
        SELECT count(*)::int FROM ${registrations} r
        WHERE r.event_id = "events"."id" AND r.checked_in_at IS NOT NULL
      )`,
      revenuePaise: sql<number>`(
        SELECT coalesce(sum(p.amount_paise), 0)::int
        FROM ${payments} p JOIN ${registrations} r ON r.id = p.registration_id
        WHERE r.event_id = "events"."id" AND p.status = 'CAPTURED'
      )`,
    })
    .from(events)
    .where(eq(events.clubId, clubId))
    .orderBy(desc(events.startsAt));

  // Volunteers only need to reach the scanner, not the numbers.
  return rows.map(({ registrations: regs, checkins, revenuePaise, ...event }) => ({
    ...event,
    stats: showNumbers ? { registrations: regs, checkins, revenuePaise } : null,
  }));
}

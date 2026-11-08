import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import { validateAnswers } from "@/lib/event-questions";
import { formatDateTime } from "@/lib/time";
import type { RegisterInput } from "@/lib/validation";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { clubs, events, registrations, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { enqueue } from "@/server/jobs/queue";

import type { Transaction } from "./audit";
import { assertValidEventId } from "./events";
import {
  type CheckoutDetails,
  releaseSeat,
  resumeCheckout,
  startCheckout,
} from "./payments";

const HOLD_MINUTES = 10;

export type RegisterResult =
  | { status: "CONFIRMED"; registrationId: string }
  | ({ status: "PENDING_PAYMENT"; registrationId: string } & CheckoutDetails);

function explainClosed(event: typeof events.$inferSelect): string {
  const now = new Date();
  if (event.status !== "PUBLISHED") return "Registration isn't open for this event.";
  if (now < event.registrationOpensAt) {
    return `Registration opens ${formatDateTime(event.registrationOpensAt)}.`;
  }
  if (now > event.registrationClosesAt) return "Registration has closed.";
  return "This event is full.";
}

/** Reserves one seat, or returns false if the event can't take another. */
async function reserveSeat(tx: Transaction, eventId: string, now: Date) {
  // One conditional statement: Postgres locks the row, re-checks the WHERE
  // clause against the latest value, and only then adds the seat.
  const [reserved] = await tx
    .update(events)
    .set({ seatsTaken: sql`${events.seatsTaken} + 1` })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.status, "PUBLISHED"),
        lte(events.registrationOpensAt, now),
        gte(events.registrationClosesAt, now),
        lt(events.seatsTaken, events.capacity),
      ),
    )
    .returning({ id: events.id });
  return reserved !== undefined;
}

export async function register(
  actor: Actor,
  eventId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  assertCan(actor, "registration.create");
  assertValidEventId(eventId);

  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) throw new NotFoundError("That event no longer exists.");

  const checked = validateAnswers(event.customQuestions, input.answers);
  if ("error" in checked) throw new ValidationError(checked.error);

  const [user] = await db
    .select({ rollNumber: users.rollNumber })
    .from(users)
    .where(eq(users.id, actor.id));
  if (!user.rollNumber && !input.rollNumber) {
    throw new ValidationError("Enter your roll number to register.");
  }

  const [existing] = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.userId, actor.id),
        inArray(registrations.status, ["PENDING_PAYMENT", "CONFIRMED"]),
      ),
    );
  if (existing?.status === "CONFIRMED") {
    throw new ConflictError("You're already registered for this event.");
  }
  if (existing) {
    if (existing.holdExpiresAt && existing.holdExpiresAt < new Date()) {
      throw new ConflictError("Your seat hold has expired. Try again in a minute.");
    }
    return {
      status: "PENDING_PAYMENT",
      registrationId: existing.id,
      ...(await resumeCheckout(existing.id)),
    };
  }

  const isPaid = event.pricePaise > 0;
  const now = new Date();

  const registration = await db.transaction(async (tx) => {
    if (!user.rollNumber && input.rollNumber) {
      await tx
        .update(users)
        .set({ rollNumber: input.rollNumber })
        .where(eq(users.id, actor.id));
    }

    if (!(await reserveSeat(tx, eventId, now))) {
      throw new ConflictError(explainClosed(event));
    }

    // The partial unique index settles a double tap: the loser throws here,
    // which also rolls back the seat it just reserved.
    const [created] = await tx
      .insert(registrations)
      .values({
        eventId,
        userId: actor.id,
        status: isPaid ? "PENDING_PAYMENT" : "CONFIRMED",
        answers: checked.answers,
        holdExpiresAt: isPaid
          ? new Date(now.getTime() + HOLD_MINUTES * 60_000)
          : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new ConflictError("You're already registered for this event.");
    }

    if (!isPaid) {
      await enqueue(
        tx,
        JOBS.sendTicketEmail,
        { registrationId: created.id },
        { key: created.id },
      );
    }
    return created;
  });

  if (!isPaid) return { status: "CONFIRMED", registrationId: registration.id };

  // Deliberately outside the transaction: a slow payment API must not hold a
  // database lock on the event's row while everyone else waits.
  return {
    status: "PENDING_PAYMENT",
    registrationId: registration.id,
    ...(await startCheckout(registration.id, event.id, event.pricePaise)),
  };
}

export async function cancelOwnRegistration(
  actor: Actor,
  registrationId: string,
): Promise<void> {
  const [row] = await db
    .select({
      eventId: registrations.eventId,
      startsAt: events.startsAt,
      pricePaise: events.pricePaise,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(eq(registrations.id, registrationId), eq(registrations.userId, actor.id)),
    );
  if (!row) throw new NotFoundError("That ticket no longer exists.");
  if (row.pricePaise > 0) {
    throw new ConflictError("Ask the club to refund a paid ticket.");
  }
  if (row.startsAt <= new Date()) {
    throw new ConflictError("This event has already started.");
  }

  await db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(registrations)
      .set({ status: "CANCELLED" })
      .where(
        and(
          eq(registrations.id, registrationId),
          eq(registrations.status, "CONFIRMED"),
          isNull(registrations.checkedInAt),
        ),
      )
      .returning({ id: registrations.id });
    if (!cancelled) throw new ConflictError("This ticket can't be cancelled now.");
    await releaseSeat(tx, row.eventId);
  });
}

export async function getOwnRegistration(actor: Actor, eventId: string) {
  const [registration] = await db
    .select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.userId, actor.id),
        inArray(registrations.status, ["PENDING_PAYMENT", "CONFIRMED"]),
      ),
    );
  return registration ?? null;
}

export async function getRollNumber(actor: Actor): Promise<string | null> {
  const [user] = await db
    .select({ rollNumber: users.rollNumber })
    .from(users)
    .where(eq(users.id, actor.id));
  return user?.rollNumber ?? null;
}

export async function listMyTickets(actor: Actor) {
  assertCan(actor, "ticket.viewOwn");

  const tickets = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      checkedInAt: registrations.checkedInAt,
      eventSlug: events.slug,
      eventTitle: events.title,
      eventStatus: events.status,
      venue: events.venue,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      pricePaise: events.pricePaise,
      clubName: clubs.name,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(clubs, eq(clubs.id, events.clubId))
    .where(
      and(
        eq(registrations.userId, actor.id),
        inArray(registrations.status, ["CONFIRMED", "PENDING_PAYMENT", "REFUNDED"]),
      ),
    )
    .orderBy(asc(events.startsAt));

  const now = Date.now();
  const withCancel = tickets.map((ticket) => ({
    ...ticket,
    canCancel:
      ticket.status === "CONFIRMED" &&
      ticket.pricePaise === 0 &&
      !ticket.checkedInAt &&
      ticket.eventStatus === "PUBLISHED" &&
      ticket.startsAt.getTime() > now,
  }));
  return {
    upcoming: withCancel.filter((ticket) => ticket.endsAt.getTime() >= now),
    past: withCancel.filter((ticket) => ticket.endsAt.getTime() < now),
  };
}

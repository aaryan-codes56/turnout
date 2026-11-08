import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { events, payments, registrations, webhookEvents } from "@/server/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { enqueue } from "@/server/jobs/queue";
import { logger } from "@/server/logger";
import {
  createOrder,
  currentPaymentMode,
  fetchOrderPayments,
  fetchRefunds,
  refundPayment,
} from "@/server/payments/razorpay";
import {
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/server/payments/signature";

import { recordAudit, type Transaction } from "./audit";

export type CheckoutDetails = {
  orderId: string;
  amountPaise: number;
  keyId: string;
};

function keyId(): string {
  if (!env.RAZORPAY_KEY_ID) {
    throw new ValidationError("Paid registration isn't set up yet.");
  }
  return env.RAZORPAY_KEY_ID;
}

export async function releaseSeat(tx: Transaction, eventId: string) {
  await tx
    .update(events)
    .set({ seatsTaken: sql`${events.seatsTaken} - 1` })
    .where(and(eq(events.id, eventId), sql`${events.seatsTaken} > 0`));
}

/** Creates the Razorpay order. If that fails, gives the seat straight back. */
export async function startCheckout(
  registrationId: string,
  eventId: string,
  amountPaise: number,
): Promise<CheckoutDetails> {
  try {
    const order = await createOrder({ amountPaise, registrationId });
    await db.insert(payments).values({
      registrationId,
      razorpayOrderId: order.id,
      amountPaise,
      mode: currentPaymentMode(),
    });
    return { orderId: order.id, amountPaise, keyId: keyId() };
  } catch (error) {
    logger.error({ err: error, registrationId }, "Could not create Razorpay order");
    await db.transaction(async (tx) => {
      const [cancelled] = await tx
        .update(registrations)
        .set({ status: "CANCELLED", holdExpiresAt: null })
        .where(
          and(
            eq(registrations.id, registrationId),
            eq(registrations.status, "PENDING_PAYMENT"),
          ),
        )
        .returning({ id: registrations.id });
      if (cancelled) await releaseSeat(tx, eventId);
    });
    throw new ConflictError("Couldn't start the payment. Please try again.");
  }
}

/** A student can retry a failed payment on the same order while the hold lasts. */
export async function resumeCheckout(
  registrationId: string,
): Promise<CheckoutDetails> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.registrationId, registrationId));
  if (!payment) throw new ConflictError("Your payment is still starting. Try again.");
  return {
    orderId: payment.razorpayOrderId,
    amountPaise: payment.amountPaise,
    keyId: keyId(),
  };
}

export type ConfirmOutcome =
  | "CONFIRMED"
  | "ALREADY_CONFIRMED"
  | "LATE_CONFIRMED"
  | "REFUND_QUEUED"
  | "IGNORED";

/**
 * The single path to a paid confirmation. The browser callback, the webhook
 * and the reconciliation job can all call this at once for one order. The row
 * lock makes them take turns, and only the first finds PENDING_PAYMENT, so
 * there is one confirmation and one ticket email however many arrive.
 */
export async function confirmPayment(params: {
  orderId: string;
  paymentId: string;
  raw?: Record<string, unknown>;
}): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.razorpayOrderId, params.orderId))
      .for("update");
    if (!payment) {
      logger.warn({ orderId: params.orderId }, "Payment confirmation for unknown order");
      return "IGNORED";
    }
    if (payment.status === "REFUNDED") return "IGNORED";

    if (payment.status !== "CAPTURED") {
      await tx
        .update(payments)
        .set({
          status: "CAPTURED",
          razorpayPaymentId: params.paymentId,
          raw: params.raw ?? payment.raw,
        })
        .where(eq(payments.id, payment.id));
    }

    const [registration] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, payment.registrationId))
      .for("update");

    if (registration.status === "CONFIRMED") return "ALREADY_CONFIRMED";
    if (registration.status === "REFUNDED") return "IGNORED";
    // A late payment is decided once, when it's first captured. If a refund
    // was queued, a repeat delivery must not issue a ticket for that money.
    if (payment.status === "CAPTURED" && registration.status !== "PENDING_PAYMENT") {
      return "IGNORED";
    }

    const queueTicket = () =>
      enqueue(
        tx,
        JOBS.sendTicketEmail,
        { registrationId: registration.id },
        { key: registration.id },
      );

    if (registration.status === "PENDING_PAYMENT") {
      await tx
        .update(registrations)
        .set({ status: "CONFIRMED", holdExpiresAt: null })
        .where(eq(registrations.id, registration.id));
      await queueTicket();
      return "CONFIRMED";
    }

    // The money arrived after the hold ended. Honour it if a seat is still
    // free and they haven't re-registered. Never oversell to save a payment.
    const [activeElsewhere] = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, registration.eventId),
          eq(registrations.userId, registration.userId),
          ne(registrations.id, registration.id),
          inArray(registrations.status, ["PENDING_PAYMENT", "CONFIRMED"]),
        ),
      );
    const [seat] = activeElsewhere
      ? []
      : await tx
          .update(events)
          .set({ seatsTaken: sql`${events.seatsTaken} + 1` })
          .where(
            and(
              eq(events.id, registration.eventId),
              eq(events.status, "PUBLISHED"),
              lt(events.seatsTaken, events.capacity),
            ),
          )
          .returning({ id: events.id });

    if (seat) {
      await tx
        .update(registrations)
        .set({ status: "CONFIRMED", holdExpiresAt: null })
        .where(eq(registrations.id, registration.id));
      await queueTicket();
      return "LATE_CONFIRMED";
    }

    await enqueue(
      tx,
      JOBS.refundRegistration,
      { registrationId: registration.id, reason: "late_payment" },
      { key: registration.id },
    );
    return "REFUND_QUEUED";
  });
}

export async function verifyClientPayment(
  actor: Actor,
  params: { orderId: string; paymentId: string; signature: string },
): Promise<void> {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new ValidationError("Paid registration isn't set up yet.");
  }
  if (!verifyCheckoutSignature(params, env.RAZORPAY_KEY_SECRET)) {
    throw new ValidationError("That payment couldn't be verified.");
  }

  // A valid signature proves the payment happened, not whose it is.
  const [owner] = await db
    .select({ userId: registrations.userId })
    .from(payments)
    .innerJoin(registrations, eq(registrations.id, payments.registrationId))
    .where(eq(payments.razorpayOrderId, params.orderId));
  if (!owner) throw new NotFoundError("That order doesn't exist.");
  if (owner.userId !== actor.id) throw new ForbiddenError();

  await confirmPayment({ orderId: params.orderId, paymentId: params.paymentId });
}

/** Marks a refund done. Both the job and the webhook can call this safely. */
export async function applyRefund(razorpayPaymentId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .update(payments)
      .set({ status: "REFUNDED" })
      .where(
        and(
          eq(payments.razorpayPaymentId, razorpayPaymentId),
          eq(payments.status, "CAPTURED"),
        ),
      )
      .returning();
    if (!payment) return false;

    const [registration] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, payment.registrationId))
      .for("update");

    await tx
      .update(registrations)
      .set({ status: "REFUNDED", holdExpiresAt: null })
      .where(eq(registrations.id, registration.id));
    // A registration that wasn't confirmed never held a seat at this point.
    if (registration.status === "CONFIRMED") {
      await releaseSeat(tx, registration.eventId);
    }
    return true;
  });
}

type RazorpayWebhook = {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string } };
    order?: { entity: { id: string } };
    refund?: { entity: { id: string; payment_id: string } };
  };
};

async function processWebhook(webhook: RazorpayWebhook, raw: Record<string, unknown>) {
  const payment = webhook.payload.payment?.entity;

  switch (webhook.event) {
    case "payment.captured":
    case "order.paid":
      if (payment) {
        await confirmPayment({
          orderId: payment.order_id,
          paymentId: payment.id,
          raw,
        });
      }
      return;
    case "payment.failed":
      // Only a payment still in flight can fail. If this arrives late, after
      // a capture, it must not undo it. The seat stays held so they can retry.
      if (payment) {
        await db
          .update(payments)
          .set({ status: "FAILED", razorpayPaymentId: payment.id, raw })
          .where(
            and(
              eq(payments.razorpayOrderId, payment.order_id),
              eq(payments.status, "CREATED"),
            ),
          );
      }
      return;
    case "refund.processed":
      if (webhook.payload.refund) {
        await applyRefund(webhook.payload.refund.entity.payment_id);
      }
      return;
    default:
      logger.info({ event: webhook.event }, "Ignoring Razorpay webhook");
  }
}

export async function handleRazorpayWebhook(params: {
  rawBody: string;
  signature: string | null;
  eventId: string | null;
}): Promise<"processed" | "duplicate"> {
  const { rawBody, signature, eventId } = params;
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new ValidationError("Webhooks aren't set up yet.");
  }
  if (
    !signature ||
    !eventId ||
    !verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)
  ) {
    throw new ForbiddenError();
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const webhook = payload as unknown as RazorpayWebhook;

  await db
    .insert(webhookEvents)
    .values({ id: eventId, type: webhook.event, payload })
    .onConflictDoNothing();
  const [stored] = await db
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, eventId));
  // A delivery that crashed midway has no processedAt, so a retry finishes it.
  if (stored.processedAt) return "duplicate";

  await processWebhook(webhook, payload);
  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, eventId));
  return "processed";
}

/** Runs every minute. Asks Razorpay first, because a webhook may just be late. */
export async function expireHoldsAndReconcile(): Promise<{
  confirmed: number;
  expired: number;
}> {
  const due = await db
    .select({
      registrationId: registrations.id,
      eventId: registrations.eventId,
      orderId: payments.razorpayOrderId,
    })
    .from(registrations)
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(
      and(
        eq(registrations.status, "PENDING_PAYMENT"),
        lt(registrations.holdExpiresAt, new Date()),
      ),
    )
    .limit(200);

  let confirmed = 0;
  let expired = 0;

  for (const hold of due) {
    if (hold.orderId) {
      let gatewayPayments;
      try {
        gatewayPayments = await fetchOrderPayments(hold.orderId);
      } catch (error) {
        // Without an answer we can't release the seat safely. Try next minute.
        logger.error({ err: error, orderId: hold.orderId }, "Reconcile lookup failed");
        continue;
      }
      const captured = gatewayPayments.find((p) => p.status === "captured");
      if (captured) {
        await confirmPayment({ orderId: hold.orderId, paymentId: captured.id });
        confirmed++;
        continue;
      }
    }

    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(registrations)
        .set({ status: "EXPIRED" })
        .where(
          and(
            eq(registrations.id, hold.registrationId),
            eq(registrations.status, "PENDING_PAYMENT"),
          ),
        )
        .returning({ id: registrations.id });
      if (!row) return;
      await releaseSeat(tx, hold.eventId);
      await tx
        .update(payments)
        .set({ status: "FAILED" })
        .where(
          and(
            eq(payments.registrationId, hold.registrationId),
            eq(payments.status, "CREATED"),
          ),
        );
      expired++;
    });
  }
  return { confirmed, expired };
}

/** Admin refund. The money moves in a background job. */
export async function requestRefund(actor: Actor, registrationId: string) {
  const [row] = await db
    .select({
      clubId: events.clubId,
      registrationStatus: registrations.status,
      paymentStatus: payments.status,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(payments, eq(payments.registrationId, registrations.id))
    .where(eq(registrations.id, registrationId));
  if (!row) throw new NotFoundError("That registration no longer exists.");
  assertCan(actor, "refund.issue", { clubId: row.clubId });

  if (row.registrationStatus !== "CONFIRMED" || row.paymentStatus !== "CAPTURED") {
    throw new ConflictError("Only a confirmed, paid registration can be refunded.");
  }

  await db.transaction(async (tx) => {
    await enqueue(
      tx,
      JOBS.refundRegistration,
      { registrationId, reason: "admin" },
      { key: registrationId },
    );
    await recordAudit(tx, {
      actorId: actor.id,
      action: "refund.requested",
      entityType: "registration",
      entityId: registrationId,
    });
  });
}

/**
 * Sends the refund to Razorpay. Asking for existing refunds first means a
 * retry after a crash can't refund the same payment twice.
 */
export async function executeRefund(registrationId: string): Promise<boolean> {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.registrationId, registrationId));
  if (!payment?.razorpayPaymentId || payment.status !== "CAPTURED") return false;

  const [existing] = await fetchRefunds(payment.razorpayPaymentId);
  const refund =
    existing ?? (await refundPayment(payment.razorpayPaymentId, payment.amountPaise));

  await db
    .update(payments)
    .set({ razorpayRefundId: refund.id })
    .where(eq(payments.id, payment.id));

  if (refund.status === "processed") await applyRefund(payment.razorpayPaymentId);
  return true;
}

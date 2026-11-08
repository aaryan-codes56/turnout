import { createHmac, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { events, payments, registrations, webhookEvents } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { handlers } from "@/server/jobs/handlers";
import {
  fetchOrderPayments,
  fetchRefunds,
  refundPayment,
} from "@/server/payments/razorpay";
import {
  confirmPayment,
  executeRefund,
  expireHoldsAndReconcile,
  handleRazorpayWebhook,
  requestRefund,
  verifyClientPayment,
} from "@/server/services/payments";

import {
  actorOf,
  addMember,
  closeConnections,
  createClub,
  createEvent,
  createRegistration,
  createUser,
  jobs,
  resetDatabase,
} from "./helpers";

vi.mock("@/server/payments/razorpay", () => ({
  createOrder: vi.fn(),
  currentPaymentMode: () => "TEST",
  paymentsConfigured: () => true,
  fetchOrderPayments: vi.fn(async () => []),
  fetchRefunds: vi.fn(async () => []),
  refundPayment: vi.fn(async () => ({ id: "rfnd_1", status: "processed" })),
}));

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET as string;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET as string;

async function pendingPayment(
  eventOverrides: Parameters<typeof createEvent>[1] = {},
  registrationOverrides: Parameters<typeof createRegistration>[2] = {},
) {
  const club = await createClub(await createUser());
  const event = await createEvent(club.id, {
    pricePaise: 5000,
    seatsTaken: 1,
    ...eventOverrides,
  });
  const user = await createUser();
  const registration = await createRegistration(event.id, user, {
    status: "PENDING_PAYMENT",
    holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    ...registrationOverrides,
  });
  const orderId = `order_${randomUUID()}`;
  await db.insert(payments).values({
    registrationId: registration.id,
    razorpayOrderId: orderId,
    amountPaise: 5000,
    mode: "TEST",
  });
  return { club, event, user, registration, orderId };
}

async function statusOf(registrationId: string) {
  const [row] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.id, registrationId));
  return row.status;
}

async function paymentFor(orderId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, orderId));
  return row;
}

async function seatsTaken(eventId: string) {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row.seatsTaken;
}

function signWebhook(body: string, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function deliver(body: object, eventId: string = randomUUID()) {
  const rawBody = JSON.stringify(body);
  return handleRazorpayWebhook({
    rawBody,
    signature: signWebhook(rawBody),
    eventId,
  });
}

const capturedWebhook = (orderId: string, paymentId = "pay_1") => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: paymentId, order_id: orderId } } },
});

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.mocked(fetchOrderPayments).mockResolvedValue([]);
  vi.mocked(fetchRefunds).mockResolvedValue([]);
  vi.mocked(refundPayment).mockResolvedValue({ id: "rfnd_1", status: "processed" });
});
afterAll(closeConnections);

describe("webhook", () => {
  it("rejects a tampered body", async () => {
    const { orderId, registration } = await pendingPayment();
    const original = JSON.stringify(capturedWebhook(orderId));

    await expect(
      handleRazorpayWebhook({
        rawBody: original.replace("pay_1", "pay_2"),
        signature: signWebhook(original),
        eventId: randomUUID(),
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const { orderId } = await pendingPayment();
    const rawBody = JSON.stringify(capturedWebhook(orderId));

    await expect(
      handleRazorpayWebhook({
        rawBody,
        signature: signWebhook(rawBody, "some-other-secret"),
        eventId: randomUUID(),
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await db.select().from(webhookEvents)).toEqual([]);
  });

  it("delivered 3 times makes one confirmation and one email job", async () => {
    const { orderId, registration } = await pendingPayment();
    const eventId = randomUUID();

    expect(await deliver(capturedWebhook(orderId), eventId)).toBe("processed");
    expect(await deliver(capturedWebhook(orderId), eventId)).toBe("duplicate");
    expect(await deliver(capturedWebhook(orderId), eventId)).toBe("duplicate");

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
  });

  it("delivered 3 times at once still makes one email job", async () => {
    const { orderId, registration } = await pendingPayment();
    const eventId = randomUUID();

    await Promise.all([
      deliver(capturedWebhook(orderId), eventId),
      deliver(capturedWebhook(orderId), eventId),
      deliver(capturedWebhook(orderId), eventId),
    ]);

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
  });

  it("gets order.paid after payment.captured with no second email", async () => {
    const { orderId } = await pendingPayment();

    await deliver(capturedWebhook(orderId));
    await deliver({
      event: "order.paid",
      payload: {
        order: { entity: { id: orderId } },
        payment: { entity: { id: "pay_1", order_id: orderId } },
      },
    });

    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
  });

  it("marks a failed payment and keeps the seat held for a retry", async () => {
    const { event, orderId, registration } = await pendingPayment();

    await deliver({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_f", order_id: orderId } } },
    });

    expect((await paymentFor(orderId)).status).toBe("FAILED");
    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
    expect(await seatsTaken(event.id)).toBe(1);

    await deliver(capturedWebhook(orderId, "pay_retry"));
    expect(await statusOf(registration.id)).toBe("CONFIRMED");
  });

  it("ignores a payment.failed that arrives after the capture", async () => {
    const { orderId, registration } = await pendingPayment();

    await deliver(capturedWebhook(orderId));
    await deliver({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_old", order_id: orderId } } },
    });

    expect((await paymentFor(orderId)).status).toBe("CAPTURED");
    expect(await statusOf(registration.id)).toBe("CONFIRMED");
  });

  it("marks refund.processed and releases the seat once", async () => {
    const { event, orderId, registration } = await pendingPayment({ seatsTaken: 3 });
    await deliver(capturedWebhook(orderId, "pay_r"));
    const refund = {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_9", payment_id: "pay_r" } } },
    };

    await deliver(refund);
    await deliver(refund);

    expect(await statusOf(registration.id)).toBe("REFUNDED");
    expect((await paymentFor(orderId)).status).toBe("REFUNDED");
    expect(await seatsTaken(event.id)).toBe(2);
  });

  it("finishes the work on a retry if the first delivery crashed", async () => {
    const { orderId, registration } = await pendingPayment();
    const eventId = randomUUID();
    const body = capturedWebhook(orderId);
    await db
      .insert(webhookEvents)
      .values({ id: eventId, type: body.event, payload: body });

    expect(await deliver(body, eventId)).toBe("processed");
    expect(await statusOf(registration.id)).toBe("CONFIRMED");
  });
});

describe("client verification", () => {
  function sign(orderId: string, paymentId: string, secret = KEY_SECRET) {
    return createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
  }

  it("confirms a correctly signed payment", async () => {
    const { user, orderId, registration } = await pendingPayment();

    await verifyClientPayment(await actorOf(user), {
      orderId,
      paymentId: "pay_c",
      signature: sign(orderId, "pay_c"),
    });

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
  });

  it.each([
    ["a tampered payment id", (o: string) => sign(o, "pay_other")],
    ["the wrong secret", (o: string) => sign(o, "pay_c", "wrong-secret")],
  ])("refuses %s", async (_name, signature) => {
    const { user, orderId, registration } = await pendingPayment();

    await expect(
      verifyClientPayment(await actorOf(user), {
        orderId,
        paymentId: "pay_c",
        signature: signature(orderId),
      }),
    ).rejects.toThrow(ValidationError);
    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
  });

  it("refuses someone else's order even with a valid signature", async () => {
    const { orderId, registration } = await pendingPayment();
    const stranger = await actorOf(await createUser());

    await expect(
      verifyClientPayment(stranger, {
        orderId,
        paymentId: "pay_c",
        signature: sign(orderId, "pay_c"),
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
  });
});

describe("confirmation race", () => {
  it("client verify, webhook and reconcile together confirm once", async () => {
    const { user, orderId, registration } = await pendingPayment();
    await db
      .update(registrations)
      .set({ holdExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(registrations.id, registration.id));
    vi.mocked(fetchOrderPayments).mockResolvedValue([
      { id: "pay_race", status: "captured" },
    ]);

    await Promise.all([
      verifyClientPayment(await actorOf(user), {
        orderId,
        paymentId: "pay_race",
        signature: createHmac("sha256", KEY_SECRET)
          .update(`${orderId}|pay_race`)
          .digest("hex"),
      }),
      deliver(capturedWebhook(orderId, "pay_race")),
      expireHoldsAndReconcile(),
    ]);

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
    expect(await jobs(JOBS.refundRegistration)).toEqual([]);
  });

  it("sends one ticket email even if the job runs twice", async () => {
    const { registration, orderId } = await pendingPayment();
    await confirmPayment({ orderId, paymentId: "pay_1" });

    await handlers[JOBS.sendTicketEmail]({ registrationId: registration.id });
    await handlers[JOBS.sendTicketEmail]({ registrationId: registration.id });

    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("expireHoldsAndReconcile", () => {
  const expiredHold = { holdExpiresAt: new Date(Date.now() - 1000) };

  it("expires an unpaid hold and releases the seat", async () => {
    const { event, registration, orderId } = await pendingPayment({}, expiredHold);

    expect(await expireHoldsAndReconcile()).toEqual({ confirmed: 0, expired: 1 });

    expect(await statusOf(registration.id)).toBe("EXPIRED");
    expect(await seatsTaken(event.id)).toBe(0);
    expect((await paymentFor(orderId)).status).toBe("FAILED");
  });

  it("confirms instead if Razorpay says it was paid", async () => {
    const { event, registration } = await pendingPayment({}, expiredHold);
    vi.mocked(fetchOrderPayments).mockResolvedValue([
      { id: "pay_late", status: "captured" },
    ]);

    expect(await expireHoldsAndReconcile()).toEqual({ confirmed: 1, expired: 0 });

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("keeps the hold if Razorpay can't be reached", async () => {
    const { event, registration } = await pendingPayment({}, expiredHold);
    vi.mocked(fetchOrderPayments).mockRejectedValue(new Error("timeout"));

    await expireHoldsAndReconcile();

    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("leaves holds that haven't expired alone", async () => {
    const { registration } = await pendingPayment();
    await expireHoldsAndReconcile();
    expect(await statusOf(registration.id)).toBe("PENDING_PAYMENT");
  });
});

describe("payment captured after the hold expired", () => {
  const expired = { status: "EXPIRED" as const, holdExpiresAt: null };

  it("confirms if a seat is still free", async () => {
    const { event, orderId, registration } = await pendingPayment(
      { capacity: 5, seatsTaken: 0 },
      expired,
    );

    expect(await confirmPayment({ orderId, paymentId: "pay_l" })).toBe("LATE_CONFIRMED");

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
    expect(await seatsTaken(event.id)).toBe(1);
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
  });

  it("takes one seat when a late payment is confirmed twice at once", async () => {
    const { event, orderId } = await pendingPayment(
      { capacity: 5, seatsTaken: 0 },
      expired,
    );

    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => confirmPayment({ orderId, paymentId: "pay_l" })),
    );

    expect(outcomes.filter((outcome) => outcome === "LATE_CONFIRMED")).toHaveLength(1);
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("refunds rather than oversells when the event is full", async () => {
    const { event, orderId, registration } = await pendingPayment(
      { capacity: 1, seatsTaken: 1 },
      expired,
    );

    expect(await confirmPayment({ orderId, paymentId: "pay_l" })).toBe("REFUND_QUEUED");

    expect(await statusOf(registration.id)).toBe("EXPIRED");
    expect(await seatsTaken(event.id)).toBe(1);
    expect(await jobs(JOBS.sendTicketEmail)).toEqual([]);
    expect(await jobs(JOBS.refundRegistration)).toMatchObject([
      { data: { registrationId: registration.id, reason: "late_payment" } },
    ]);

    await handlers[JOBS.refundRegistration]({
      registrationId: registration.id,
      reason: "late_payment",
    });

    expect(await statusOf(registration.id)).toBe("REFUNDED");
    expect(await seatsTaken(event.id)).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("refunds if they have since registered again", async () => {
    const { event, user, orderId } = await pendingPayment(
      { capacity: 5, seatsTaken: 1 },
      expired,
    );
    await createRegistration(event.id, user);

    expect(await confirmPayment({ orderId, paymentId: "pay_l" })).toBe("REFUND_QUEUED");
    expect(await seatsTaken(event.id)).toBe(1);
  });
});

describe("refunds", () => {
  async function paid() {
    const data = await pendingPayment({ seatsTaken: 2 });
    await confirmPayment({ orderId: data.orderId, paymentId: "pay_p" });
    return data;
  }

  it("lets a club admin queue one and audits it", async () => {
    const { club, registration } = await paid();
    const admin = await createUser();
    await addMember(club.id, admin, "ADMIN");

    await requestRefund(await actorOf(admin), registration.id);

    expect(await jobs(JOBS.refundRegistration)).toHaveLength(1);
  });

  it("is refused for a volunteer", async () => {
    const { club, registration } = await paid();
    const volunteer = await createUser();
    await addMember(club.id, volunteer, "VOLUNTEER");

    await expect(
      requestRefund(await actorOf(volunteer), registration.id),
    ).rejects.toThrow(ForbiddenError);
    expect(await jobs(JOBS.refundRegistration)).toEqual([]);
  });

  it("completes and releases the seat", async () => {
    const { event, registration, orderId } = await paid();

    await executeRefund(registration.id);

    expect(refundPayment).toHaveBeenCalledWith("pay_p", 5000);
    expect((await paymentFor(orderId)).razorpayRefundId).toBe("rfnd_1");
    expect(await statusOf(registration.id)).toBe("REFUNDED");
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("never refunds twice when a job retries after a crash", async () => {
    const { registration } = await paid();
    vi.mocked(fetchRefunds).mockResolvedValue([
      { id: "rfnd_existing", status: "processed" },
    ]);

    await executeRefund(registration.id);

    expect(refundPayment).not.toHaveBeenCalled();
    expect(await statusOf(registration.id)).toBe("REFUNDED");
  });

  it("waits for the webhook when the refund is still processing", async () => {
    const { registration } = await paid();
    vi.mocked(refundPayment).mockResolvedValue({ id: "rfnd_2", status: "pending" });

    await executeRefund(registration.id);

    expect(await statusOf(registration.id)).toBe("CONFIRMED");
  });
});

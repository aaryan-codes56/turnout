import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { events, payments, registrations, users } from "@/server/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import {
  cancelOwnRegistration,
  register,
} from "@/server/services/registrations";

import {
  actorOf,
  closeConnections,
  createClub,
  createEvent,
  createRegistration,
  createUser,
  jobs,
  resetDatabase,
} from "./helpers";

vi.mock("@/server/payments/razorpay", () => ({
  createOrder: vi.fn(async ({ registrationId }: { registrationId: string }) => ({
    id: `order_${registrationId}`,
  })),
  currentPaymentMode: () => "TEST",
  paymentsConfigured: () => true,
  fetchOrderPayments: vi.fn(),
  fetchRefunds: vi.fn(),
  refundPayment: vi.fn(),
}));

const withRoll = { answers: {}, rollNumber: "2024BCS001" };

async function setup(overrides: Parameters<typeof createEvent>[1] = {}) {
  const club = await createClub(await createUser());
  return createEvent(club.id, overrides);
}

async function seatsTaken(eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  return event.seatsTaken;
}

async function registrationsFor(eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId));
}

beforeEach(resetDatabase);
afterAll(closeConnections);

describe("capacity race", () => {
  it("gives 50 simultaneous students exactly 10 of 10 free seats", async () => {
    const event = await setup({ capacity: 10 });
    const actors = await Promise.all(
      Array.from({ length: 50 }, async () => actorOf(await createUser())),
    );

    const results = await Promise.allSettled(
      actors.map((actor) => register(actor, event.id, withRoll)),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(rejected).toHaveLength(40);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ConflictError);
    }
    expect(await seatsTaken(event.id)).toBe(10);
    expect(await registrationsFor(event.id)).toHaveLength(10);
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(10);
  });

  it("holds exactly 10 of 10 paid seats for 50 simultaneous students", async () => {
    const event = await setup({ capacity: 10, pricePaise: 5000 });
    const actors = await Promise.all(
      Array.from({ length: 50 }, async () => actorOf(await createUser())),
    );

    const results = await Promise.allSettled(
      actors.map((actor) => register(actor, event.id, withRoll)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(await seatsTaken(event.id)).toBe(10);
    const held = await registrationsFor(event.id);
    expect(held.every((r) => r.status === "PENDING_PAYMENT")).toBe(true);
  });

  it("gives one seat to one student double-tapping", async () => {
    const event = await setup();
    const actor = await actorOf(await createUser());

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => register(actor, event.id, withRoll)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await seatsTaken(event.id)).toBe(1);
    expect(await jobs(JOBS.sendTicketEmail)).toHaveLength(1);
  });
});

describe("register", () => {
  it("confirms a free event immediately and queues the ticket email", async () => {
    const event = await setup();
    const actor = await actorOf(await createUser());

    const result = await register(actor, event.id, withRoll);

    expect(result.status).toBe("CONFIRMED");
    const [registration] = await registrationsFor(event.id);
    expect(registration.status).toBe("CONFIRMED");
    expect(await jobs(JOBS.sendTicketEmail)).toMatchObject([
      { data: { registrationId: registration.id } },
    ]);
  });

  it("holds a paid seat for 10 minutes, with the amount from the database", async () => {
    const event = await setup({ pricePaise: 7500 });
    const actor = await actorOf(await createUser());

    const result = await register(actor, event.id, withRoll);

    expect(result).toMatchObject({
      status: "PENDING_PAYMENT",
      amountPaise: 7500,
      keyId: "rzp_test_integration",
    });
    const [registration] = await registrationsFor(event.id);
    const holdMs = registration.holdExpiresAt!.getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(9 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(10 * 60_000);
    expect(await db.select().from(payments)).toMatchObject([
      { amountPaise: 7500, status: "CREATED", mode: "TEST" },
    ]);
    expect(await jobs(JOBS.sendTicketEmail)).toEqual([]);
  });

  it("returns the same order when a paid registration is retried", async () => {
    const event = await setup({ pricePaise: 7500 });
    const actor = await actorOf(await createUser());

    const first = await register(actor, event.id, withRoll);
    const second = await register(actor, event.id, withRoll);

    expect(second).toEqual(first);
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("gives the seat back if the order can't be created", async () => {
    const { createOrder } = await import("@/server/payments/razorpay");
    vi.mocked(createOrder).mockRejectedValueOnce(new Error("Razorpay is down"));
    const event = await setup({ pricePaise: 7500 });
    const actor = await actorOf(await createUser());

    await expect(register(actor, event.id, withRoll)).rejects.toThrow(ConflictError);

    expect(await seatsTaken(event.id)).toBe(0);
    const [registration] = await registrationsFor(event.id);
    expect(registration.status).toBe("CANCELLED");
  });

  it.each([
    ["before it opens", { registrationOpensAt: new Date(Date.now() + 60_000) }],
    ["after it closes", { registrationClosesAt: new Date(Date.now() - 60_000) }],
    ["for a draft", { status: "DRAFT" as const }],
    ["for a cancelled event", { status: "CANCELLED" as const }],
  ])("refuses registration %s", async (_name, overrides) => {
    const event = await setup(overrides);
    const actor = await actorOf(await createUser());

    await expect(register(actor, event.id, withRoll)).rejects.toThrow(ConflictError);
    expect(await seatsTaken(event.id)).toBe(0);
  });

  it("treats a garbled event id as not found", async () => {
    const actor = await actorOf(await createUser());
    await expect(register(actor, "not-a-uuid", withRoll)).rejects.toThrow(NotFoundError);
  });

  it("asks for a roll number once, then remembers it", async () => {
    const event = await setup();
    const second = await setup();
    const user = await createUser();
    const actor = await actorOf(user);

    await expect(
      register(actor, event.id, { answers: {} }),
    ).rejects.toThrow(ValidationError);

    await register(actor, event.id, withRoll);
    await register(actor, second.id, { answers: {} });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.rollNumber).toBe("2024BCS001");
  });

  describe("custom questions", () => {
    const customQuestions = [
      { id: "team", type: "short_text" as const, label: "Team", required: true },
      {
        id: "size",
        type: "single_select" as const,
        label: "Size",
        required: false,
        options: ["S", "M"],
      },
    ];

    it("stores valid answers and drops anything not asked", async () => {
      const event = await setup({ customQuestions });
      const actor = await actorOf(await createUser());

      await register(actor, event.id, {
        ...withRoll,
        answers: { team: "Falcons", size: "M", isAdmin: true },
      });

      const [registration] = await registrationsFor(event.id);
      expect(registration.answers).toEqual({ team: "Falcons", size: "M" });
    });

    it.each([
      ["a missing required answer", { size: "M" }],
      ["an option that wasn't offered", { team: "Falcons", size: "XXL" }],
    ])("refuses %s and takes no seat", async (_name, answers) => {
      const event = await setup({ customQuestions });
      const actor = await actorOf(await createUser());

      await expect(
        register(actor, event.id, { ...withRoll, answers }),
      ).rejects.toThrow(ValidationError);
      expect(await seatsTaken(event.id)).toBe(0);
    });
  });
});

describe("cancelOwnRegistration", () => {
  async function registered(overrides: Parameters<typeof createEvent>[1] = {}) {
    const event = await setup({ seatsTaken: 1, ...overrides });
    const user = await createUser();
    const registration = await createRegistration(event.id, user);
    return { event, registration, actor: await actorOf(user) };
  }

  it("cancels and releases the seat for re-registration", async () => {
    const { event, registration, actor } = await registered({ capacity: 1 });

    await cancelOwnRegistration(actor, registration.id);
    expect(await seatsTaken(event.id)).toBe(0);

    await register(actor, event.id, withRoll);
    expect(await seatsTaken(event.id)).toBe(1);
  });

  it("releases one seat when cancelled twice at once", async () => {
    const { event, registration, actor } = await registered({ seatsTaken: 5 });

    await Promise.allSettled([
      cancelOwnRegistration(actor, registration.id),
      cancelOwnRegistration(actor, registration.id),
    ]);

    expect(await seatsTaken(event.id)).toBe(4);
  });

  it("refuses after the event has started", async () => {
    const { registration, actor } = await registered({
      startsAt: new Date(Date.now() - 60_000),
    });
    await expect(
      cancelOwnRegistration(actor, registration.id),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses a paid ticket", async () => {
    const { registration, actor } = await registered({ pricePaise: 1000 });
    await expect(
      cancelOwnRegistration(actor, registration.id),
    ).rejects.toThrow(ConflictError);
  });

  it("can't cancel someone else's ticket", async () => {
    const { registration } = await registered();
    const stranger = await actorOf(await createUser());
    await expect(
      cancelOwnRegistration(stranger, registration.id),
    ).rejects.toThrow("no longer exists");
  });
});

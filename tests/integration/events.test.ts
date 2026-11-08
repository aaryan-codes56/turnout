import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db/client";
import { events, metricsSnapshots, payments, registrations } from "@/server/db/schema";
import { ConflictError, ForbiddenError, RateLimitError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { handlers } from "@/server/jobs/handlers";
import { enforceRateLimit } from "@/server/rate-limit";
import {
  cancelEvent,
  createEvent as createEventService,
  getPublicEventBySlug,
  listDashboardEvents,
  listPublicClubEvents,
  publishEvent,
  setEventTestFlag,
  updateEvent,
} from "@/server/services/events";
import { getImpactMetrics, writeMetricsSnapshot } from "@/server/services/metrics";

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

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})) }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));
vi.mock("@/server/payments/razorpay", () => ({
  paymentsConfigured: () => true,
  currentPaymentMode: () => "TEST",
}));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const startsAt = new Date(Date.now() + 3 * DAY);
const form = {
  title: "Robot Wars",
  descriptionMd: "Bring your robot and a spare battery.",
  coverUrl: null,
  venue: "Main Hall",
  startsAt,
  endsAt: new Date(startsAt.getTime() + 2 * HOUR),
  capacity: 50,
  pricePaise: 0,
  registrationOpensAt: null,
  registrationClosesAt: null,
  checkinOpensBeforeMinutes: 120,
  customQuestions: [],
};

async function ownedClub() {
  const owner = await createUser();
  const club = await createClub(owner);
  return { club, owner, actor: await actorOf(owner) };
}

beforeEach(async () => {
  await resetDatabase();
  sendMail.mockClear();
});
afterAll(closeConnections);

describe("event lifecycle", () => {
  it("creates a draft that the public can't see", async () => {
    const { club, actor } = await ownedClub();

    const event = await createEventService(actor, club.id, form);

    expect(event.status).toBe("DRAFT");
    expect(await getPublicEventBySlug(event.slug)).toBeNull();
  });

  it.each(["ADMIN", "OWNER"] as const)("lets a club %s create events", async (role) => {
    const { club } = await ownedClub();
    const member = await createUser();
    await addMember(club.id, member, role);

    await expect(
      createEventService(await actorOf(member), club.id, form),
    ).resolves.toBeDefined();
  });

  it("refuses a volunteer", async () => {
    const { club } = await ownedClub();
    const volunteer = await createUser();
    await addMember(club.id, volunteer, "VOLUNTEER");

    await expect(
      createEventService(await actorOf(volunteer), club.id, form),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses an admin of a different club", async () => {
    const { club } = await ownedClub();
    const { actor: other } = await ownedClub();
    await expect(createEventService(other, club.id, form)).rejects.toThrow(ForbiddenError);
  });

  it("publishing schedules both reminders and the summary", async () => {
    const { club, actor } = await ownedClub();
    const draft = await createEventService(actor, club.id, form);

    const event = await publishEvent(actor, draft.id);

    expect(await getPublicEventBySlug(event.slug)).not.toBeNull();
    const reminders = await jobs(JOBS.eventReminder);
    expect(reminders.map((job) => job.data.kind).sort()).toEqual(["24h", "2h"]);
    expect(await jobs(JOBS.postEventSummary)).toHaveLength(1);
    const dayBefore = reminders.find((job) => job.data.kind === "24h");
    expect(new Date(dayBefore!.start_after).getTime()).toBe(startsAt.getTime() - DAY);
  });

  it("skips a reminder whose time has already passed", async () => {
    const { club, actor } = await ownedClub();
    const soon = new Date(Date.now() + 5 * HOUR);
    const draft = await createEventService(actor, club.id, {
      ...form,
      startsAt: soon,
      endsAt: new Date(soon.getTime() + HOUR),
    });

    await publishEvent(actor, draft.id);

    expect((await jobs(JOBS.eventReminder)).map((job) => job.data.kind)).toEqual(["2h"]);
  });

  it("publishing twice does nothing the second time", async () => {
    const { club, actor } = await ownedClub();
    const draft = await createEventService(actor, club.id, form);

    await publishEvent(actor, draft.id);
    await expect(publishEvent(actor, draft.id)).rejects.toThrow(ConflictError);
    expect(await jobs(JOBS.eventReminder)).toHaveLength(2);
  });

  it("won't drop capacity below the seats already taken", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id, { seatsTaken: 20, capacity: 50 });

    await expect(
      updateEvent(actor, event.id, { ...form, capacity: 19 }),
    ).rejects.toThrow(ConflictError);
  });

  it("won't change the price once people have registered", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id, { seatsTaken: 1 });

    await expect(
      updateEvent(actor, event.id, { ...form, pricePaise: 1000 }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("reminders", () => {
  async function publishedWithAttendee() {
    const { club, actor } = await ownedClub();
    const draft = await createEventService(actor, club.id, form);
    const event = await publishEvent(actor, draft.id);
    await createRegistration(event.id, await createUser());
    await db.update(events).set({ seatsTaken: 1 }).where(eq(events.id, event.id));
    return { event, actor };
  }

  const payload = (event: typeof events.$inferSelect) =>
    ({ eventId: event.id, kind: "24h", startsAt: event.startsAt.toISOString() }) as const;

  it("emails each attendee once, even if the job retries", async () => {
    const { event } = await publishedWithAttendee();

    await handlers[JOBS.eventReminder](payload(event));
    await handlers[JOBS.eventReminder](payload(event));

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("reschedules on a time change and the old reminder goes quiet", async () => {
    const { event, actor } = await publishedWithAttendee();
    const later = new Date(startsAt.getTime() + DAY);

    await updateEvent(actor, event.id, {
      ...form,
      startsAt: later,
      endsAt: new Date(later.getTime() + 2 * HOUR),
    });

    expect(await jobs(JOBS.eventReminder)).toHaveLength(4);
    await handlers[JOBS.eventReminder](payload(event));
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("is skipped once the event is cancelled", async () => {
    const { event, actor } = await publishedWithAttendee();
    await cancelEvent(actor, event.id);
    sendMail.mockClear();

    await handlers[JOBS.eventReminder](payload(event));

    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("cancelEvent", () => {
  it("frees seats and notifies attendees of a free event", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id, { seatsTaken: 2 });
    await createRegistration(event.id, await createUser());
    await createRegistration(event.id, await createUser());

    await cancelEvent(actor, event.id);

    const rows = await db.select().from(registrations);
    expect(rows.every((row) => row.status === "CANCELLED")).toBe(true);
    const [updated] = await db.select().from(events).where(eq(events.id, event.id));
    expect(updated.seatsTaken).toBe(0);
    expect(await jobs(JOBS.sendCancellationNotice)).toHaveLength(2);
    expect(await jobs(JOBS.refundRegistration)).toEqual([]);
  });

  it("queues one refund per confirmed paid registration", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id, { pricePaise: 5000, seatsTaken: 3 });
    await createRegistration(event.id, await createUser());
    await createRegistration(event.id, await createUser());
    await createRegistration(event.id, await createUser(), { status: "PENDING_PAYMENT" });

    await cancelEvent(actor, event.id);

    expect(await jobs(JOBS.refundRegistration)).toHaveLength(2);
    expect(await jobs(JOBS.sendCancellationNotice)).toHaveLength(2);
  });

  it("can't cancel twice", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id);

    await cancelEvent(actor, event.id);
    await expect(cancelEvent(actor, event.id)).rejects.toThrow(ConflictError);
  });
});

describe("dashboard", () => {
  it("shows numbers to managers and hides them from volunteers", async () => {
    const { club, actor } = await ownedClub();
    const event = await createEvent(club.id, { pricePaise: 5000 });
    const registration = await createRegistration(event.id, await createUser());
    await db.insert(payments).values({
      registrationId: registration.id,
      razorpayOrderId: "order_1",
      amountPaise: 5000,
      status: "CAPTURED",
      mode: "TEST",
    });
    const volunteer = await createUser();
    await addMember(club.id, volunteer, "VOLUNTEER");

    expect(await listDashboardEvents(actor, club.id)).toMatchObject([
      { stats: { registrations: 1, checkins: 0, revenuePaise: 5000 } },
    ]);
    expect(await listDashboardEvents(await actorOf(volunteer), club.id)).toMatchObject([
      { stats: null },
    ]);
  });

  it("splits a club page into upcoming and past", async () => {
    const { club } = await ownedClub();
    await createEvent(club.id, { title: "Next" });
    await createEvent(club.id, {
      title: "Old",
      status: "COMPLETED",
      startsAt: new Date(Date.now() - 2 * DAY),
      endsAt: new Date(Date.now() - DAY),
    });
    await createEvent(club.id, { title: "Hidden", status: "DRAFT" });

    const { upcoming, past } = await listPublicClubEvents(club.id);

    expect(upcoming.map((event) => event.title)).toEqual(["Next"]);
    expect(past.map((event) => event.title)).toEqual(["Old"]);
  });
});

describe("post-event summary", () => {
  it("emails club managers once with real numbers", async () => {
    const { club } = await ownedClub();
    const admin = await createUser();
    await addMember(club.id, admin, "ADMIN");
    const volunteer = await createUser();
    await addMember(club.id, volunteer, "VOLUNTEER");
    const event = await createEvent(club.id);
    await createRegistration(event.id, await createUser(), { checkedInAt: new Date() });
    await createRegistration(event.id, await createUser());
    const data = { eventId: event.id, endsAt: event.endsAt.toISOString() };

    await handlers[JOBS.postEventSummary](data);
    await handlers[JOBS.postEventSummary](data);

    expect(sendMail).toHaveBeenCalledTimes(2); // Owner and admin, not volunteer.
    expect(JSON.stringify(sendMail.mock.calls[0])).toContain("50%");
  });
});

describe("completeEndedEvents", () => {
  it("marks only finished published events as completed", async () => {
    const { club } = await ownedClub();
    const ended = await createEvent(club.id, {
      startsAt: new Date(Date.now() - 2 * HOUR),
      endsAt: new Date(Date.now() - HOUR),
    });
    const upcoming = await createEvent(club.id);

    await handlers[JOBS.completeEndedEvents]({});

    const [first] = await db.select().from(events).where(eq(events.id, ended.id));
    const [second] = await db.select().from(events).where(eq(events.id, upcoming.id));
    expect(first.status).toBe("COMPLETED");
    expect(second.status).toBe("PUBLISHED");
  });
});

describe("impact metrics", () => {
  const past = {
    status: "COMPLETED" as const,
    startsAt: new Date(Date.now() - 2 * DAY),
    endsAt: new Date(Date.now() - DAY),
  };
  const checkedIn = { checkedInAt: new Date() };

  it("counts real check-ins", async () => {
    const { club } = await ownedClub();
    const event = await createEvent(club.id, past);
    const student = await createUser();
    await createRegistration(event.id, student, checkedIn);
    await createRegistration(event.id, await createUser()); // Didn't turn up.
    const second = await createEvent(club.id, past);
    await createRegistration(second.id, student, checkedIn);

    const { totals, perClub, perMonth } = await getImpactMetrics();

    expect(totals).toEqual({
      activeClubs: 1,
      events: 2,
      checkins: 2,
      uniqueAttendees: 1,
    });
    expect(perClub).toMatchObject([{ checkins: 2 }]);
    expect(perMonth.reduce((sum, row) => sum + row.events, 0)).toBe(2);
  });

  it.each(["event", "club", "user"] as const)("excludes a test %s", async (kind) => {
    const owner = await createUser();
    const club = await createClub(owner);
    if (kind === "club") await db.execute(`UPDATE clubs SET is_test = true`);
    const event = await createEvent(club.id, { ...past, isTest: kind === "event" });
    const student = await createUser();
    if (kind === "user") await db.execute(`UPDATE users SET is_test = true`);
    await createRegistration(event.id, student, checkedIn);

    expect((await getImpactMetrics()).totals.checkins).toBe(0);
  });

  it("excludes tickets bought with test-mode money, but not live ones", async () => {
    const { club } = await ownedClub();
    const event = await createEvent(club.id, past);
    const testTicket = await createRegistration(event.id, await createUser(), checkedIn);
    const liveTicket = await createRegistration(event.id, await createUser(), checkedIn);
    await db.insert(payments).values([
      { registrationId: testTicket.id, razorpayOrderId: "o1", amountPaise: 100, mode: "TEST" },
      { registrationId: liveTicket.id, razorpayOrderId: "o2", amountPaise: 100, mode: "LIVE" },
    ]);

    expect((await getImpactMetrics()).totals.checkins).toBe(1);
  });

  it("drops an event once an admin marks it as test", async () => {
    const { club } = await ownedClub();
    const event = await createEvent(club.id, past);
    await createRegistration(event.id, await createUser(), checkedIn);
    const admin = await actorOf(await createUser("SUPER_ADMIN"));

    await setEventTestFlag(admin, event.id, true);

    expect((await getImpactMetrics()).totals).toMatchObject({ checkins: 0, events: 0 });
  });

  it("writes one snapshot per day, replacing the earlier one", async () => {
    await writeMetricsSnapshot();
    await writeMetricsSnapshot();
    expect(await db.select().from(metricsSnapshots)).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and refuses the next", async () => {
    await enforceRateLimit("test:key", 2, 60);
    await enforceRateLimit("test:key", 2, 60);
    await expect(enforceRateLimit("test:key", 2, 60)).rejects.toThrow(RateLimitError);
  });

  it("counts correctly under concurrency", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => enforceRateLimit("test:busy", 5, 60)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
  });

  it("keeps separate counts per key", async () => {
    await enforceRateLimit("test:a", 1, 60);
    await expect(enforceRateLimit("test:b", 1, 60)).resolves.toBeUndefined();
  });
});

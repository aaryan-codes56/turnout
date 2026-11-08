import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, registrations } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { exportAttendeesCsv, listAttendees } from "@/server/services/attendees";
import {
  checkInManually,
  checkInWithQr,
  getCheckinCounts,
  searchForCheckin,
} from "@/server/services/checkin";
import { createQrPayload, verifyQrPayload } from "@/server/tickets/qr-token";

import {
  actorOf,
  addMember,
  closeConnections,
  createClub,
  createEvent,
  createRegistration,
  createUser,
  resetDatabase,
} from "./helpers";

const HOUR = 60 * 60 * 1000;

async function setup(overrides: Parameters<typeof createEvent>[1] = {}) {
  const owner = await createUser();
  const club = await createClub(owner);
  const event = await createEvent(club.id, overrides);
  const volunteer = await createUser();
  await addMember(club.id, volunteer, "VOLUNTEER");
  const student = await createUser();
  const registration = await createRegistration(event.id, student);
  return {
    club,
    event,
    student,
    registration,
    actor: await actorOf(volunteer),
    volunteer,
  };
}

beforeEach(resetDatabase);
afterAll(closeConnections);

describe("QR tokens", () => {
  const id = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";

  it("round-trips a valid payload and contains no personal data", () => {
    const payload = createQrPayload(id);
    expect(verifyQrPayload(payload)).toBe(id);
    expect(payload.startsWith(`${id}.`)).toBe(true);
  });

  it.each([
    ["no signature", id],
    ["an empty signature", `${id}.`],
    ["a wrong signature", `${id}.AAAA`],
    ["a non-uuid id", "abc.def"],
    ["extra segments", `${createQrPayload(id)}.extra`],
    ["garbage", "https://example.com"],
  ])("rejects %s", (_name, payload) => {
    expect(verifyQrPayload(payload)).toBeNull();
  });

  it("rejects one ticket's signature on another ticket's id", () => {
    const signature = createQrPayload(id).split(".")[1];
    const other = "aaaaaaaa-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
    expect(verifyQrPayload(`${other}.${signature}`)).toBeNull();
  });
});

describe("checkInWithQr", () => {
  it("returns OK with who it is, and records who scanned them", async () => {
    const { event, registration, actor, volunteer, student } = await setup();

    const result = await checkInWithQr(actor, event.id, createQrPayload(registration.id));

    expect(result).toMatchObject({ code: "OK", attendee: { email: student.email } });
    const [row] = await db.select().from(registrations);
    expect(row.checkedInBy).toBe(volunteer.id);
    expect(row.checkedInAt).toBeInstanceOf(Date);
    expect(await db.select().from(auditLogs)).toMatchObject([{ action: "checkin.qr" }]);
  });

  it("includes custom answers as ticket notes", async () => {
    const { event, actor } = await setup({
      customQuestions: [
        { id: "team", type: "short_text", label: "Team", required: true },
      ],
    });
    const student = await createUser();
    const registration = await createRegistration(event.id, student, {
      answers: { team: "Falcons" },
    });

    const result = await checkInWithQr(actor, event.id, createQrPayload(registration.id));

    expect(result).toMatchObject({
      attendee: { notes: [{ label: "Team", value: "Falcons" }] },
    });
  });

  it("reports when and by whom on a double scan", async () => {
    const { event, registration, actor, volunteer } = await setup();
    const payload = createQrPayload(registration.id);

    await checkInWithQr(actor, event.id, payload);
    const second = await checkInWithQr(actor, event.id, payload);

    expect(second).toMatchObject({
      code: "ALREADY_CHECKED_IN",
      checkedInBy: volunteer.name,
    });
  });

  it("gives exactly one OK when 10 phones scan at once", async () => {
    const { event, registration, actor } = await setup();
    const payload = createQrPayload(registration.id);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkInWithQr(actor, event.id, payload)),
    );

    expect(results.filter((r) => r.code === "OK")).toHaveLength(1);
    expect(results.filter((r) => r.code === "ALREADY_CHECKED_IN")).toHaveLength(9);
    expect(await db.select().from(auditLogs)).toHaveLength(1);
  });

  it("refuses a ticket for another event", async () => {
    const { club, registration, actor } = await setup();
    const otherEvent = await createEvent(club.id);

    const result = await checkInWithQr(actor, otherEvent.id, createQrPayload(registration.id));

    expect(result.code).toBe("WRONG_EVENT");
  });

  it("refuses a forged ticket", async () => {
    const { event, registration, actor } = await setup();
    const result = await checkInWithQr(actor, event.id, `${registration.id}.forged`);
    expect(result.code).toBe("INVALID");
  });

  it("refuses a correctly signed ticket that doesn't exist", async () => {
    const { event, actor } = await setup();
    const result = await checkInWithQr(
      actor,
      event.id,
      createQrPayload("aaaaaaaa-9d4a-4e6f-8a7b-1c2d3e4f5a6b"),
    );
    expect(result.code).toBe("INVALID");
  });

  it.each(["PENDING_PAYMENT", "CANCELLED", "EXPIRED", "REFUNDED"] as const)(
    "refuses a %s ticket",
    async (status) => {
      const { event, actor } = await setup();
      const registration = await createRegistration(event.id, await createUser(), {
        status,
      });

      const result = await checkInWithQr(actor, event.id, createQrPayload(registration.id));

      expect(result.code).toBe("NOT_CONFIRMED");
    },
  );

  it.each([
    [
      "before check-in opens",
      { startsAt: new Date(Date.now() + 3 * HOUR), endsAt: new Date(Date.now() + 5 * HOUR) },
    ],
    [
      "after the event ends",
      { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR) },
    ],
    ["for a cancelled event", { status: "CANCELLED" as const }],
  ])("refuses %s and writes nothing", async (_name, overrides) => {
    const { event, registration, actor } = await setup(overrides);

    const result = await checkInWithQr(actor, event.id, createQrPayload(registration.id));

    expect(result.code).toBe("OUTSIDE_WINDOW");
    const [row] = await db.select().from(registrations);
    expect(row.checkedInAt).toBeNull();
  });

  it("uses the event's own early check-in setting", async () => {
    const { event, registration, actor } = await setup({
      startsAt: new Date(Date.now() + 3 * HOUR),
      endsAt: new Date(Date.now() + 5 * HOUR),
      checkinOpensBeforeMinutes: 240,
    });

    const result = await checkInWithQr(actor, event.id, createQrPayload(registration.id));

    expect(result.code).toBe("OK");
  });

  it("is forbidden for a volunteer from another club", async () => {
    const { event, registration } = await setup();
    const other = await setup();

    await expect(
      checkInWithQr(other.actor, event.id, createQrPayload(registration.id)),
    ).rejects.toThrow(ForbiddenError);
  });

  it("is forbidden for an ordinary student", async () => {
    const { event, registration, student } = await setup();

    await expect(
      checkInWithQr(await actorOf(student), event.id, createQrPayload(registration.id)),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("manual check-in", () => {
  it("checks in with one tap and is audited as manual", async () => {
    const { event, registration, actor } = await setup();

    const result = await checkInManually(actor, event.id, registration.id);

    expect(result.code).toBe("OK");
    expect(await db.select().from(auditLogs)).toMatchObject([
      { action: "checkin.manual" },
    ]);
  });

  it("finds attendees and returns only door details", async () => {
    const { event, actor, student } = await setup();

    const [match, ...rest] = await searchForCheckin(actor, event.id, student.email.slice(0, 12));

    expect(rest).toEqual([]);
    expect(Object.keys(match).sort()).toEqual(
      ["checkedInAt", "email", "name", "registrationId", "rollNumber"].sort(),
    );
  });

  it("treats % in a search as a literal character", async () => {
    const { event, actor } = await setup();
    expect(await searchForCheckin(actor, event.id, "%%")).toEqual([]);
  });

  it("counts confirmed and checked in", async () => {
    const { event, registration, actor } = await setup();
    await createRegistration(event.id, await createUser());
    await checkInManually(actor, event.id, registration.id);

    expect(await getCheckinCounts(actor, event.id)).toEqual({
      confirmed: 2,
      checkedIn: 1,
    });
  });
});

describe("attendee list and export", () => {
  it("is forbidden for volunteers", async () => {
    const { event, actor } = await setup();

    await expect(listAttendees(actor, event.id, {})).rejects.toThrow(ForbiddenError);
    await expect(exportAttendeesCsv(actor, event.id)).rejects.toThrow(ForbiddenError);
  });

  it("exports custom answers, safely", async () => {
    const owner = await createUser();
    const club = await createClub(owner);
    const event = await createEvent(club.id, {
      customQuestions: [
        { id: "team", type: "short_text", label: "Team name", required: true },
      ],
    });
    await createRegistration(event.id, await createUser(), {
      answers: { team: "=HYPERLINK(\"evil\")" },
    });

    const { csv } = await exportAttendeesCsv(await actorOf(owner), event.id);

    expect(csv).toContain('"Team name"');
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
  });

  it("filters by status and search", async () => {
    const owner = await createUser();
    const club = await createClub(owner);
    const event = await createEvent(club.id);
    const student = await createUser("USER", "findme@nst.rishihood.edu.in");
    await createRegistration(event.id, student);
    await createRegistration(event.id, await createUser(), { status: "CANCELLED" });
    const actor = await actorOf(owner);

    expect(await listAttendees(actor, event.id, { status: "CANCELLED" })).toHaveLength(1);
    expect(await listAttendees(actor, event.id, { query: "findme" })).toMatchObject([
      { email: student.email },
    ]);
  });
});

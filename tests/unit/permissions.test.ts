import { describe, expect, it } from "vitest";

import {
  type Action,
  ACTIONS,
  type Actor,
  assertCan,
  can,
  type ClubRole,
} from "@/server/auth/permissions";
import { ForbiddenError } from "@/server/errors";

const CLUB = { clubId: "club-a" };
const OTHER_CLUB = { clubId: "club-b" };

type Persona = "STUDENT" | "VOLUNTEER" | "ADMIN" | "OWNER" | "SUPER_ADMIN";
const PERSONAS: Persona[] = [
  "STUDENT",
  "VOLUNTEER",
  "ADMIN",
  "OWNER",
  "SUPER_ADMIN",
];

function actorFor(persona: Persona): Actor {
  if (persona === "STUDENT") {
    return { id: "u", platformRole: "USER", memberships: [] };
  }
  if (persona === "SUPER_ADMIN") {
    return { id: "u", platformRole: "SUPER_ADMIN", memberships: [] };
  }
  return {
    id: "u",
    platformRole: "USER",
    memberships: [{ clubId: CLUB.clubId, role: persona }],
  };
}

// Written out by hand from the product spec, deliberately not derived from
// permissions.ts, so a mistake in either one fails here.
const ALL: Persona[] = PERSONAS;
const STAFF: Persona[] = ["VOLUNTEER", "ADMIN", "OWNER", "SUPER_ADMIN"];
const MANAGERS: Persona[] = ["ADMIN", "OWNER", "SUPER_ADMIN"];
const OWNERS: Persona[] = ["OWNER", "SUPER_ADMIN"];
const SUPER: Persona[] = ["SUPER_ADMIN"];

const SPEC: Record<Action, Persona[]> = {
  "event.browse": ALL,
  "registration.create": ALL,
  "ticket.viewOwn": ALL,
  "club.request": ALL,
  "club.viewDashboard": STAFF,
  "checkin.perform": STAFF,
  "event.create": MANAGERS,
  "event.edit": MANAGERS,
  "event.publish": MANAGERS,
  "event.cancel": MANAGERS,
  "attendee.list": MANAGERS,
  "attendee.export": MANAGERS,
  "refund.issue": MANAGERS,
  "member.view": OWNERS,
  "member.invite": OWNERS,
  "member.remove": OWNERS,
  "member.changeRole": OWNERS,
  "club.approve": SUPER,
  "club.archive": SUPER,
  "platform.manageAdmins": SUPER,
  "platform.viewMetrics": SUPER,
  "platform.viewFailedJobs": SUPER,
  "audit.view": SUPER,
};

const CLUB_SCOPED = ACTIONS.filter(
  (action) => SPEC[action].includes("VOLUNTEER") || SPEC[action].includes("ADMIN") || SPEC[action].includes("OWNER"),
).filter((action) => !SPEC[action].includes("STUDENT"));

describe("permission matrix", () => {
  it("has an expected result for every action in permissions.ts", () => {
    expect(Object.keys(SPEC).sort()).toEqual([...ACTIONS].sort());
  });

  describe.each(ACTIONS)("%s", (action) => {
    it.each(PERSONAS)("for %s", (persona) => {
      expect(can(actorFor(persona), action, CLUB)).toBe(
        SPEC[action].includes(persona),
      );
    });
  });
});

describe("club scoping", () => {
  const roles: ClubRole[] = ["VOLUNTEER", "ADMIN", "OWNER"];

  describe.each(CLUB_SCOPED)("%s", (action) => {
    it.each(roles)("gives a %s no rights in another club", (role) => {
      const actor: Actor = {
        id: "u",
        platformRole: "USER",
        memberships: [{ clubId: CLUB.clubId, role }],
      };
      expect(can(actor, action, OTHER_CLUB)).toBe(false);
    });

    it.each(roles)("refuses a %s when no club is named", (role) => {
      const actor: Actor = {
        id: "u",
        platformRole: "USER",
        memberships: [{ clubId: CLUB.clubId, role }],
      };
      expect(can(actor, action)).toBe(false);
    });

    it("lets a super admin act on any club", () => {
      expect(can(actorFor("SUPER_ADMIN"), action, OTHER_CLUB)).toBe(true);
    });
  });

  it("applies each club's own role to someone in several clubs", () => {
    const actor: Actor = {
      id: "u",
      platformRole: "USER",
      memberships: [
        { clubId: CLUB.clubId, role: "OWNER" },
        { clubId: OTHER_CLUB.clubId, role: "VOLUNTEER" },
      ],
    };
    expect(can(actor, "member.invite", CLUB)).toBe(true);
    expect(can(actor, "member.invite", OTHER_CLUB)).toBe(false);
    expect(can(actor, "checkin.perform", OTHER_CLUB)).toBe(true);
  });
});

describe("assertCan", () => {
  it("returns quietly when allowed", () => {
    expect(() =>
      assertCan(actorFor("OWNER"), "member.invite", CLUB),
    ).not.toThrow();
  });

  it("throws ForbiddenError when refused", () => {
    expect(() =>
      assertCan(actorFor("VOLUNTEER"), "member.invite", CLUB),
    ).toThrow(ForbiddenError);
  });
});

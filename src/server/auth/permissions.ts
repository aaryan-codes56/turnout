import { ForbiddenError } from "@/server/errors";

export const CLUB_ROLES = ["OWNER", "ADMIN", "VOLUNTEER"] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];
export type PlatformRole = "USER" | "SUPER_ADMIN";

export type Actor = {
  id: string;
  platformRole: PlatformRole;
  memberships: readonly { clubId: string; role: ClubRole }[];
};

export type ClubResource = { clubId: string };

// STUDENT means any signed-in user, whatever their club roles.
type MatrixRole = "STUDENT" | ClubRole | "SUPER_ADMIN";

const everyone: readonly MatrixRole[] = [
  "STUDENT",
  "VOLUNTEER",
  "ADMIN",
  "OWNER",
  "SUPER_ADMIN",
];
const clubStaff: readonly MatrixRole[] = [
  "VOLUNTEER",
  "ADMIN",
  "OWNER",
  "SUPER_ADMIN",
];
const clubManagers: readonly MatrixRole[] = ["ADMIN", "OWNER", "SUPER_ADMIN"];
const clubOwners: readonly MatrixRole[] = ["OWNER", "SUPER_ADMIN"];
const superAdmins: readonly MatrixRole[] = ["SUPER_ADMIN"];

const PERMISSIONS = {
  "event.browse": everyone,
  "registration.create": everyone,
  "ticket.viewOwn": everyone,
  "club.request": everyone,

  "club.viewDashboard": clubStaff,
  "checkin.perform": clubStaff,

  "event.create": clubManagers,
  "event.edit": clubManagers,
  "event.publish": clubManagers,
  "event.cancel": clubManagers,
  "attendee.list": clubManagers,
  "attendee.export": clubManagers,
  "refund.issue": clubManagers,

  "member.view": clubOwners,
  "member.invite": clubOwners,
  "member.remove": clubOwners,
  "member.changeRole": clubOwners,

  "club.approve": superAdmins,
  "club.archive": superAdmins,
  "platform.manageAdmins": superAdmins,
  "platform.viewMetrics": superAdmins,
  "platform.viewFailedJobs": superAdmins,
  "audit.view": superAdmins,
  "event.markTest": superAdmins,
} as const satisfies Record<string, readonly MatrixRole[]>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

/**
 * The one place that answers "may this actor do this?".
 *
 * Club roles only count for the club named in `resource`, so a club-scoped
 * action without a resource is refused rather than guessed at.
 */
export function can(
  actor: Actor,
  action: Action,
  resource?: ClubResource,
): boolean {
  const allowed: readonly MatrixRole[] = PERMISSIONS[action];

  if (actor.platformRole === "SUPER_ADMIN") {
    return allowed.includes("SUPER_ADMIN");
  }
  if (allowed.includes("STUDENT")) return true;
  if (!resource) return false;

  const membership = actor.memberships.find(
    (m) => m.clubId === resource.clubId,
  );
  return membership !== undefined && allowed.includes(membership.role);
}

export function assertCan(
  actor: Actor,
  action: Action,
  resource?: ClubResource,
): void {
  if (!can(actor, action, resource)) throw new ForbiddenError();
}

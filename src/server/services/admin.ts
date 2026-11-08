import { asc, count, desc, eq } from "drizzle-orm";

import type { SetPlatformRoleInput } from "@/lib/validation";
import { type Actor, assertCan } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";
import { ConflictError, NotFoundError } from "@/server/errors";

import { recordAudit } from "./audit";

export const AUDIT_PAGE_SIZE = 50;

export async function listSuperAdmins(actor: Actor) {
  assertCan(actor, "platform.manageAdmins");

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.platformRole, "SUPER_ADMIN"))
    .orderBy(asc(users.name));
}

export async function setPlatformRole(
  actor: Actor,
  { email, role }: SetPlatformRoleInput,
) {
  assertCan(actor, "platform.manageAdmins");

  await db.transaction(async (tx) => {
    // Locking every super admin row makes concurrent demotions run in turn,
    // so two admins demoting each other can't leave the platform with none.
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.platformRole, "SUPER_ADMIN"))
      .for("update");

    const [target] = await tx
      .select({ id: users.id, platformRole: users.platformRole })
      .from(users)
      .where(eq(users.email, email));
    if (!target) {
      throw new NotFoundError(
        "No account uses that email. They need to sign in once first.",
      );
    }
    if (target.platformRole === role) return;

    if (role === "USER" && admins.length <= 1) {
      throw new ConflictError(
        "Turnout needs at least one super admin. Promote someone else first.",
      );
    }

    await tx
      .update(users)
      .set({ platformRole: role })
      .where(eq(users.id, target.id));
    await recordAudit(tx, {
      actorId: actor.id,
      action: "platform.role_changed",
      entityType: "user",
      entityId: target.id,
      metadata: { email, from: target.platformRole, to: role },
    });
  });
}

export async function listAuditLogs(actor: Actor, page: number) {
  assertCan(actor, "audit.view");

  const [entries, [{ total }]] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE),
    db.select({ total: count() }).from(auditLogs),
  ]);
  return { entries, total };
}

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import {
  AUDIT_PAGE_SIZE,
  listAuditLogs,
  listSuperAdmins,
  setPlatformRole,
} from "@/server/services/admin";

import { actorOf, auditActions, createUser, resetDatabase, settle } from "./helpers";

async function platformRoleOf(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user.platformRole;
}

beforeEach(resetDatabase);
afterAll(() => pool.end());

describe("setPlatformRole", () => {
  it("promotes a user and logs it", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const student = await createUser();

    await setPlatformRole(admin, { email: student.email, role: "SUPER_ADMIN" });

    expect(await platformRoleOf(student.id)).toBe("SUPER_ADMIN");
    expect(await auditActions()).toEqual(["platform.role_changed"]);
  });

  it("is refused for a regular user trying to promote themselves", async () => {
    const student = await createUser();

    await expect(
      setPlatformRole(await actorOf(student), {
        email: student.email,
        role: "SUPER_ADMIN",
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await platformRoleOf(student.id)).toBe("USER");
  });

  it("reports an email with no account", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    await expect(
      setPlatformRole(admin, {
        email: "nobody@nst.rishihood.edu.in",
        role: "SUPER_ADMIN",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("blocks demoting the last super admin", async () => {
    const user = await createUser("SUPER_ADMIN");

    await expect(
      setPlatformRole(await actorOf(user), { email: user.email, role: "USER" }),
    ).rejects.toThrow(ConflictError);
    expect(await platformRoleOf(user.id)).toBe("SUPER_ADMIN");
  });

  it("leaves one super admin when two demote each other at once", async () => {
    const first = await createUser("SUPER_ADMIN");
    const second = await createUser("SUPER_ADMIN");
    const [firstActor, secondActor] = await Promise.all([
      actorOf(first),
      actorOf(second),
    ]);

    const { fulfilled } = await settle([
      setPlatformRole(firstActor, { email: second.email, role: "USER" }),
      setPlatformRole(secondActor, { email: first.email, role: "USER" }),
    ]);

    expect(fulfilled).toBe(1);
    const remaining = await db
      .select()
      .from(users)
      .where(eq(users.platformRole, "SUPER_ADMIN"));
    expect(remaining).toHaveLength(1);
  });

  it("applies a demotion on the very next request", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const other = await createUser("SUPER_ADMIN");

    await setPlatformRole(admin, { email: other.email, role: "USER" });

    await expect(listSuperAdmins(await actorOf(other))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("listAuditLogs", () => {
  it("is refused for a regular user", async () => {
    await expect(
      listAuditLogs(await actorOf(await createUser()), 1),
    ).rejects.toThrow(ForbiddenError);
  });

  it("pages newest first and keeps script entries with no actor", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    await db.insert(auditLogs).values(
      Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => ({
        actorId: null,
        action: "test.action",
        entityType: "user",
        entityId: String(i),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    );

    const first = await listAuditLogs(admin, 1);
    const second = await listAuditLogs(admin, 2);

    expect(first.total).toBe(AUDIT_PAGE_SIZE + 1);
    expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.entries[0]).toMatchObject({
      entityId: String(AUDIT_PAGE_SIZE),
      actorEmail: null,
    });
    expect(second.entries.map((entry) => entry.entityId)).toEqual(["0"]);
  });
});

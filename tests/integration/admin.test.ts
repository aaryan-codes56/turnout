import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { JOBS } from "@/server/jobs/definitions";
import { getBoss } from "@/server/jobs/queue";
import {
  AUDIT_PAGE_SIZE,
  listAuditLogs,
  listFailedJobs,
  listSuperAdmins,
  retryFailedJob,
  setPlatformRole,
} from "@/server/services/admin";

import {
  actorOf,
  auditActions,
  closeConnections,
  createUser,
  resetDatabase,
  settle,
} from "./helpers";

async function platformRoleOf(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user.platformRole;
}

beforeEach(resetDatabase);
afterAll(closeConnections);

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

describe("failed jobs", () => {
  async function failedJob() {
    const boss = await getBoss();
    const id = randomUUID();
    await boss.send(JOBS.metricsSnapshot, {}, { id, retryLimit: 0 });
    const [job] = await boss.fetch(JOBS.metricsSnapshot);
    await boss.fail(JOBS.metricsSnapshot, job.id, { message: "boom" });
    return id;
  }

  it("lists a failed job and retries it", async () => {
    const admin = await actorOf(await createUser("SUPER_ADMIN"));
    const id = await failedJob();

    expect(await listFailedJobs(admin)).toMatchObject([
      { id, name: JOBS.metricsSnapshot },
    ]);

    await retryFailedJob(admin, { name: JOBS.metricsSnapshot, id });

    expect(await listFailedJobs(admin)).toEqual([]);
    expect(await auditActions()).toEqual(["job.retried"]);
  });

  it("is refused for a regular user", async () => {
    const student = await actorOf(await createUser());
    await expect(listFailedJobs(student)).rejects.toThrow(ForbiddenError);
    await expect(
      retryFailedJob(student, { name: JOBS.metricsSnapshot, id: randomUUID() }),
    ).rejects.toThrow(ForbiddenError);
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

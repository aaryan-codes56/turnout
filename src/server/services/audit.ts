import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

/** A Drizzle transaction, for services that change several tables together. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType:
    | "club"
    | "club_invite"
    | "club_membership"
    | "event"
    | "job"
    | "registration"
    | "user";
  entityId: string;
  metadata?: Record<string, unknown>;
};

/** Takes the caller's transaction so a change and its record commit together. */
export async function recordAudit(
  executor: Transaction | typeof db,
  entry: AuditEntry,
): Promise<void> {
  await executor.insert(auditLogs).values(entry);
}

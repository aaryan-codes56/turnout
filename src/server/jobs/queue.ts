import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";

import { env } from "@/lib/env";
import { logger } from "@/server/logger";
import type { Transaction } from "@/server/services/audit";

import { type JobName, jobIdFor, type JobPayloads, JOBS, RETRY_POLICY } from "./definitions";

const globalForBoss = globalThis as unknown as {
  turnoutBoss?: Promise<PgBoss>;
};

/**
 * A pg-boss client for queueing jobs only. The worker process does the
 * scheduling, maintenance and schema setup.
 */
export function getBoss(): Promise<PgBoss> {
  globalForBoss.turnoutBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      max: 3,
      schedule: false,
      supervise: false,
      migrate: false,
    });
    boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));
    await boss.start();
    return boss;
  })();
  return globalForBoss.turnoutBoss;
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, {
      ...RETRY_POLICY,
      deleteAfterSeconds: 60 * 60 * 24 * 30,
    });
  }
}

type EnqueueOptions = {
  /** Same key, same job: repeating an enqueue does nothing. */
  key: string;
  startAfter?: Date;
};

/**
 * Queues a job inside the caller's transaction. If the transaction rolls back
 * the job never existed, and if it commits the job can't be lost.
 */
export async function enqueue<N extends JobName>(
  tx: Transaction,
  name: N,
  data: JobPayloads[N],
  { key, startAfter }: EnqueueOptions,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, data, {
    id: jobIdFor(`${name}:${key}`),
    startAfter,
    db: fromDrizzle(tx, sql),
  });
}

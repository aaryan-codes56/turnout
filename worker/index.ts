// The background worker: a separate long-running process sharing src/server.
// It owns job scheduling and maintenance, which a serverless web app can't do.

import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";

import { env } from "@/lib/env";
import { pool } from "@/server/db/client";
import {
  CRON_SCHEDULES,
  type JobName,
  type JobPayloads,
  JOBS,
} from "@/server/jobs/definitions";
import { handlers } from "@/server/jobs/handlers";
import { ensureQueues } from "@/server/jobs/queue";
import { logger } from "@/server/logger";

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN });

const boss = new PgBoss({ connectionString: env.DATABASE_URL });

boss.on("error", (error) => {
  logger.error({ err: error }, "pg-boss error");
  Sentry.captureException(error);
});

async function register<N extends JobName>(name: N) {
  const handler = handlers[name] as (data: JobPayloads[N]) => Promise<void>;
  await boss.work<JobPayloads[N]>(name, { batchSize: 1 }, async ([job]) => {
    try {
      await handler(job.data);
    } catch (error) {
      logger.error({ err: error, job: name, jobId: job.id }, "Job failed");
      Sentry.captureException(error, { tags: { job: name } });
      throw error; // pg-boss retries it, then marks it failed.
    }
  });
}

async function main() {
  await boss.start();
  await ensureQueues(boss);
  for (const { name, cron } of CRON_SCHEDULES) {
    await boss.schedule(name, cron);
  }
  await Promise.all(Object.values(JOBS).map(register));
  logger.info("Worker started");
}

async function shutdown() {
  logger.info("Worker stopping");
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});

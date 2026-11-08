// Installs pg-boss's tables and creates every queue. Safe to run repeatedly.

import { PgBoss } from "pg-boss";

import { JOBS, RETRY_POLICY } from "../src/server/jobs/definitions";
import { databaseUrl, pool } from "./script-db";

async function main() {
  const boss = new PgBoss({
    connectionString: databaseUrl as string,
    schedule: false,
    supervise: false,
  });
  await boss.start();
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, {
      ...RETRY_POLICY,
      deleteAfterSeconds: 60 * 60 * 24 * 30,
    });
  }
  await boss.stop();
  console.log(`Created ${Object.values(JOBS).length} queues.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

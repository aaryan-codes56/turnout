import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";

import { JOBS, RETRY_POLICY } from "../../src/server/jobs/definitions";
import { integrationEnv } from "./test-env";

export default async function setup() {
  const pool = new Pool({ connectionString: integrationEnv.DATABASE_URL });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: "src/server/db/migrations",
    });
  } finally {
    await pool.end();
  }

  const boss = new PgBoss({
    connectionString: integrationEnv.DATABASE_URL,
    schedule: false,
    supervise: false,
  });
  await boss.start();
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, RETRY_POLICY);
  }
  await boss.stop();
}

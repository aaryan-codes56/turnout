import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

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
}

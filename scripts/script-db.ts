import { existsSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/server/db/schema";

// Scripts only need the database, so they skip the app's full env validation
// and can run before the Google OAuth values are filled in.
if (existsSync(".env")) process.loadEnvFile(".env");

export const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema, casing: "snake_case" });

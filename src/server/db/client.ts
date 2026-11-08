import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";

import * as schema from "./schema";

// Next.js dev reloads modules on every change. Keeping the pool on globalThis
// stops each reload from opening another set of connections.
const globalForDb = globalThis as unknown as { turnoutPool?: Pool };

export const pool =
  globalForDb.turnoutPool ?? new Pool({ connectionString: env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForDb.turnoutPool = pool;
}

export const db = drizzle(pool, { schema, casing: "snake_case" });

import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";
import { RateLimitError } from "@/server/errors";

/**
 * A fixed-window counter in Postgres. Vercel runs many short-lived instances,
 * so a counter in memory wouldn't be shared between them.
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} = excluded.window_start
          THEN ${rateLimits.count} + 1 ELSE 1 END`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: rateLimits.count });

  if (row.count > limit) throw new RateLimitError();
}

export async function deleteOldRateLimits(): Promise<void> {
  await db.execute(
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`,
  );
}

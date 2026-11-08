import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import { metricsSnapshots } from "@/server/db/schema";

// A check-in only counts if it's real: not a seeded user, club or event, and
// not a ticket bought with test-mode money.
const REAL_CHECKINS = sql`
  registrations r
  JOIN events e ON e.id = r.event_id
  JOIN clubs c ON c.id = e.club_id
  JOIN users u ON u.id = r.user_id
  WHERE r.checked_in_at IS NOT NULL
    AND NOT e.is_test
    AND NOT c.is_test
    AND NOT u.is_test
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.registration_id = r.id AND p.mode = 'TEST'
    )
`;

async function getTotals() {
  const { rows } = await db.execute<{
    active_clubs: number;
    checkins: number;
    unique_attendees: number;
  }>(sql`
    SELECT
      count(DISTINCT e.club_id)::int AS active_clubs,
      count(*)::int AS checkins,
      count(DISTINCT r.user_id)::int AS unique_attendees
    FROM ${REAL_CHECKINS}
  `);
  const { rows: held } = await db.execute<{ events: number }>(sql`
    SELECT count(*)::int AS events
    FROM events e JOIN clubs c ON c.id = e.club_id
    WHERE e.status IN ('PUBLISHED', 'COMPLETED')
      AND e.ends_at < now()
      AND NOT e.is_test
      AND NOT c.is_test
  `);
  return {
    activeClubs: rows[0].active_clubs,
    checkins: rows[0].checkins,
    uniqueAttendees: rows[0].unique_attendees,
    events: held[0].events,
  };
}

export async function getImpactMetrics() {
  const totals = await getTotals();

  const { rows: perClub } = await db.execute<{
    name: string;
    slug: string;
    checkins: number;
  }>(sql`
    SELECT c.name, c.slug, count(*)::int AS checkins
    FROM ${REAL_CHECKINS}
    GROUP BY c.id
    ORDER BY checkins DESC, c.name
  `);

  const { rows: perMonth } = await db.execute<{ month: string; events: number }>(sql`
    SELECT to_char(e.starts_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
      count(*)::int AS events
    FROM events e JOIN clubs c ON c.id = e.club_id
    WHERE e.status IN ('PUBLISHED', 'COMPLETED')
      AND e.ends_at < now()
      AND NOT e.is_test
      AND NOT c.is_test
    GROUP BY month
    ORDER BY month
  `);

  return { totals, perClub, perMonth };
}

export async function writeMetricsSnapshot(now = new Date()): Promise<void> {
  const totals = await getTotals();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(now);

  await db
    .insert(metricsSnapshots)
    .values({ date, ...totals })
    .onConflictDoUpdate({ target: metricsSnapshots.date, set: totals });
}

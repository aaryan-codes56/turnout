// Prepares the door-rush load test: one event, 300 confirmed tickets and a
// signed-in volunteer, all in the test database. See the README for usage.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import pg from "pg";

import { integrationEnv as env } from "../integration/test-env.ts";

const TICKETS = 300;

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
await client.query(
  "TRUNCATE users, clubs, events, registrations, audit_logs, sessions, rate_limits CASCADE",
);

const volunteerId = randomUUID();
await client.query(
  `INSERT INTO users (id, email, name, email_verified, is_test)
   VALUES ($1, 'load.volunteer@nst.rishihood.edu.in', 'Load Volunteer', true, true)`,
  [volunteerId],
);

const clubId = randomUUID();
await client.query(
  `INSERT INTO clubs (id, slug, name, description, status, created_by, is_test)
   VALUES ($1, 'load', 'Load Club', 'Load test club.', 'ACTIVE', $2, true)`,
  [clubId, volunteerId],
);
await client.query(
  "INSERT INTO club_memberships (user_id, club_id, role) VALUES ($1, $2, 'VOLUNTEER')",
  [volunteerId, clubId],
);

const eventId = randomUUID();
await client.query(
  `INSERT INTO events (id, club_id, slug, title, description_md, venue, starts_at, ends_at,
     capacity, seats_taken, status, registration_opens_at, registration_closes_at, is_test)
   VALUES ($1, $2, 'load-event', 'Load Event', 'Load test event.', 'Hall',
     now() + interval '1 hour', now() + interval '3 hours', $3, $3, 'PUBLISHED',
     now() - interval '1 hour', now() + interval '1 hour', true)`,
  [eventId, clubId, TICKETS],
);

const payloads: string[] = [];
for (let i = 0; i < TICKETS; i++) {
  const userId = randomUUID();
  const registrationId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, name, email_verified, is_test)
     VALUES ($1, $2, $3, true, true)`,
    [userId, `student${i}@load.test`, `Student ${i}`],
  );
  await client.query(
    "INSERT INTO registrations (id, event_id, user_id, status) VALUES ($1, $2, $3, 'CONFIRMED')",
    [registrationId, eventId, userId],
  );
  const signature = createHmac("sha256", env.QR_SIGNING_SECRET)
    .update(registrationId)
    .digest("base64url");
  payloads.push(`${registrationId}.${signature}`);
}

const token = randomBytes(24).toString("hex");
await client.query(
  "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day')",
  [volunteerId, token],
);
const cookieSignature = createHmac("sha256", env.BETTER_AUTH_SECRET)
  .update(token)
  .digest("base64");

mkdirSync("tests/load/.generated", { recursive: true });
writeFileSync(
  "tests/load/.generated/tickets.json",
  JSON.stringify({
    eventId,
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${cookieSignature}`)}`,
    payloads,
  }),
);
await client.end();
console.log(`Seeded ${TICKETS} tickets.`);

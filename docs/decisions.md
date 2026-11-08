# Decisions

Short notes on non-obvious choices: what we chose, why, and what we rejected.

## Domain restriction lives in `user.validateUserInfo`

**Chose:** Better Auth's `validateUserInfo` gate, calling the pure `checkSignInIdentity` function.
**Why:** It runs on the server for new users, account links and every returning Google sign-in, using the email Google just returned. If the callback throws, sign-in is rejected, and browser flows redirect with an error code.
**Rejected:** Google's `hd` parameter, which can name only one domain (we have two) and doesn't cover the policy on its own. Separate `user.create` and `session.create` database hooks, which would be two places to keep correct for the same rule.

## Domains are matched exactly

**Chose:** The part after the single `@` must equal an allowed domain.
**Why:** A suffix check accepts `evil.nst.rishihood.edu.in` and `fakerishihood.edu.in`. A new college subdomain is a one-line change to `ALLOWED_EMAIL_DOMAINS`.
**Rejected:** `endsWith` and wildcard subdomains.

## The domain check repeats when reading a session

**Chose:** `getCurrentUser` also checks the email's domain.
**Why:** `validateUserInfo` only runs at sign-in, so a session would otherwise outlive the removal of its domain by up to its full lifetime. The extra check is one string comparison.
**Rejected:** Deleting sessions when the config changes, because nothing runs at that moment.

## Additions to the §6 data model

**Chose:** `sessions`, `accounts` and `verifications` tables, plus `users.email_verified`.
**Why:** Better Auth requires them. Google tokens stay in `accounts`, away from the `users` table the app queries constantly. `roll_number` is nullable because Google can't supply it; students enter it once, before their first RSVP.
**Rejected:** Better Auth's default singular table names, which wouldn't match the rest of the schema (`usePlural` maps them).

## UUID primary keys

**Chose:** Postgres-generated UUIDs for auth tables.
**Why:** IDs appear in URLs and QR payloads, so they shouldn't reveal how many users or registrations exist or be guessable in sequence.
**Rejected:** Serial integers, which leak counts, and Better Auth's default random strings, which give up the native `uuid` column type.

## Sign-in tests fake only Google's token endpoint

**Chose:** Integration tests call the real Better Auth routes against real Postgres and stub one external HTTP call.
**Why:** Testing `isAllowedEmail` alone wouldn't prove the rule is wired into sign-in. These tests fail if the gate is removed, which was confirmed by removing it.
**Rejected:** Mocking the database or auth library, which would only test the mocks.

## `pg` as the database driver

**Chose:** `pg` for Drizzle and Better Auth.
**Why:** pg-boss depends on it already, so the app and worker share one driver. It works on Vercel's Node runtime with Neon's pooled connection string.
**Rejected:** `postgres.js` and Neon's serverless driver, either of which means two drivers in the project.

## TypeScript pinned to 6.0.x

**Chose:** TypeScript 6.0.3, not the latest 7.x.
**Why:** `typescript-eslint`, which `eslint-config-next` depends on, supports versions below 6.1. Lint would run on an unsupported compiler.
**Rejected:** TypeScript 7 with the peer warning ignored. Revisit when `typescript-eslint` supports it.

## Next.js Cache Components are off

**Chose:** Turned off the `cacheComponents` scaffold default.
**Why:** Most pages depend on who's signed in, so they'd need Suspense boundaries and explicit cache rules with little benefit at this scale. Event pages can add targeted caching if they need it.
**Rejected:** Adopting it from day one.

## Dependency build scripts stay off

**Chose:** `allowBuilds: false` for esbuild, sharp and unrs-resolver in `pnpm-workspace.yaml`.
**Why:** Each ships prebuilt binaries as optional packages, so install scripts aren't needed. Fewer third-party scripts run at install time.
**Rejected:** Approving them all to silence pnpm's prompt.

## Authorization runs inside services

**Chose:** Each service function takes an `Actor` and calls `assertCan` as its first line.
**Why:** Server actions, API routes, the worker and tests all reach the same check, so a new caller can't forget it. Pages call `can` only to decide what to show.
**Rejected:** Checking in each server action, where one missed check is a security bug and service tests wouldn't cover authorization.

## `can()` is pure and takes a loaded actor

**Chose:** `permissions.ts` doesn't touch the database; `loadActor` reads roles fresh once per request.
**Why:** The whole role matrix can be tested in milliseconds, and a demotion applies on the next request.
**Rejected:** Storing roles in the session, which stays stale until it expires.

## The club row lock protects the last owner

**Chose:** Member changes run in a transaction that starts with `SELECT ... FOR UPDATE` on the club.
**Why:** "Count the owners, then demote" is a race: two owners demoting each other could each see two owners and leave none. A row lock makes each club's member changes run one at a time, and these changes are rare, so waiting costs nothing.
**Rejected:** A database trigger, which hides a business rule where it's hard to read and test. Serializable isolation, which requires retry logic.

## Single-statement guards where there's no count to check

**Chose:** Approvals use `UPDATE ... WHERE status = 'PENDING' RETURNING`, and slugs and invites use `ON CONFLICT DO NOTHING`.
**Why:** The database decides who wins in one atomic step, so no lock is needed. It's the same pattern the check-in flow will use.
**Rejected:** Reading first and then writing, which lets two requests both pass the read.

## Pending invites apply at every sign-in

**Chose:** A `session.create.after` hook that is safe to run repeatedly.
**Why:** It covers first login, and also someone who signs up in the moment between an owner's "does this account exist?" check and the invite being saved. The lookup is one indexed query. If it fails, sign-in still succeeds and the next sign-in retries.
**Rejected:** A `user.create.after` hook, which gets one chance. Emailed invite links, which need email delivery that doesn't exist until Phase 2.

## Club logos are https links

**Chose:** Clubs paste an image URL, shown with a plain `<img>`.
**Why:** The stack has no file storage, and adding one for a logo isn't worth a new service.
**Rejected:** Upload storage, and `next/image`, which only loads from allowlisted hosts.

## The first super admin comes from a script

**Chose:** `pnpm admin:promote <email>`, which is recorded in the audit log with no actor.
**Why:** Promoting someone in the app requires already being a super admin, so the first one has to come from outside it.
**Rejected:** A `SUPER_ADMIN_EMAILS` variable, which would silently re-grant access to someone demoted in the app.

## Scripts have their own database connection

**Chose:** `scripts/script-db.ts` reads only `DATABASE_URL`.
**Why:** Seeding shouldn't need Google OAuth values just because the app's env validation does.
**Rejected:** Relaxing the app's validation, which protects production.

## pg-boss rather than BullMQ

**Chose:** pg-boss, with the queue stored in Postgres.
**Why:** A job can be queued in the same transaction as the change that caused it, so a confirmed registration can't lose its email. It's also one less service to run.
**Rejected:** BullMQ, which needs Redis and can't join a Postgres transaction. Its much higher throughput isn't needed here.

## A counter column reserves seats

**Chose:** `UPDATE events SET seats_taken = seats_taken + 1 WHERE seats_taken < capacity`, plus a `CHECK` constraint.
**Why:** It's one statement that Postgres serialises on the row, and the lock lasts only as long as the transaction. The constraint makes overselling impossible even if application code is wrong.
**Rejected:** `SELECT ... FOR UPDATE` then a count, which is more code for the same guarantee. Counting registrations on every request, which gets slower as an event fills.

## The webhook is the source of truth for payments

**Chose:** The browser callback is only a fast path. The webhook and the reconciliation job can each confirm on their own.
**Why:** Students close tabs and lose signal after paying, so the browser may never report back. Razorpay retries webhooks, and reconciliation covers a webhook that's late or lost.
**Rejected:** Trusting the browser alone, which loses paid tickets.

## One function confirms a payment

**Chose:** Every path calls `confirmPayment`, which locks the payment row first.
**Why:** Three callers can race. Under the lock, only the first finds `PENDING_PAYMENT`, and it queues the email in the same transaction.
**Rejected:** Per-caller checks and dedupe flags, where each new path is a new chance for a double confirmation.

## Webhook events are marked processed afterwards

**Chose:** Insert the event id, process it, then set `processed_at`. Only a row with `processed_at` counts as a duplicate.
**Why:** If processing crashes midway, Razorpay's retry finishes the work. Concurrent deliveries are safe because confirmation is idempotent.
**Rejected:** Treating the insert alone as "done", which would drop any event that crashed partway through.

## The order is created outside the transaction

**Chose:** Commit the seat hold, then call Razorpay. If that fails, release the seat in a new transaction.
**Why:** Holding a row lock during a network call would make everyone registering for that event wait on Razorpay.
**Rejected:** One long transaction.

## Job ids come from business keys

**Chose:** A UUID derived from a hash of keys like `send-ticket-email:<registration id>`.
**Why:** pg-boss ignores a repeated id, so queueing the same work twice does nothing.
**Rejected:** Random ids plus a check for an existing job, which can race.

## Rescheduling doesn't cancel old jobs

**Chose:** Reminders carry the event's start time. A time change queues new ones, and old ones see the mismatch and exit.
**Why:** It needs no job bookkeeping, and it can't fail halfway through a cancel-and-recreate.
**Rejected:** Storing job ids to cancel later.

## `sent_emails` prevents duplicates on retry

**Chose:** One row per email key, written after a successful send.
**Why:** A reminder job emails a list. If it fails at person 40, the retry skips the first 39. A crash between sending and recording could still send one duplicate, which is better than risking a lost ticket.
**Rejected:** Marking first and sending second, where a failed send is never retried.

## Refunds ask Razorpay first

**Chose:** `executeRefund` fetches existing refunds before creating one.
**Why:** If the worker crashes after Razorpay accepts a refund but before saving the result, a retry must not refund again.
**Rejected:** Relying on our own database, which is exactly what's out of date in that crash.

## Gmail SMTP instead of Resend

**Chose:** Nodemailer over Gmail with an App Password, keeping React Email templates. Changes the original stack.
**Why:** Resend only delivers to other people from a verified domain, and this project doesn't have one. All sending goes through one function, so switching later is a small change.
**Rejected:** Resend without a domain, which can only email the account owner. Gmail's daily sending limit is fine at this scale.

## A small markdown renderer

**Chose:** About 70 lines that turn a markdown subset into React elements.
**Why:** The approved stack has no markdown library. Building elements rather than HTML means event text can't inject scripts, and links are limited to http and https.
**Rejected:** `dangerouslySetInnerHTML` with a sanitiser, and adding a dependency for a handful of formats.

## One QR decoder

**Chose:** `@zxing/browser` everywhere.
**Why:** iPhones don't support the native `BarcodeDetector`, so zxing is needed anyway. One code path means one thing to test.
**Rejected:** Native detection with a zxing fallback, which means two paths for a small speed gain.

## No test login route

**Chose:** End-to-end tests write a session row and sign the cookie with the test secret.
**Why:** The production app contains no login bypass at all, so there's nothing to leave switched on by mistake.
**Rejected:** A `/api/test/login` route guarded by an environment variable.

## Rate limits live in Postgres

**Chose:** A fixed-window counter updated with one upsert.
**Why:** Vercel runs many short-lived instances, so a counter in memory wouldn't be shared. It adds one small query, and the load test shows that's fine.
**Rejected:** Redis, another service to run. In-memory counters, which don't work across instances.

## Failed jobs are read from pg-boss's table

**Chose:** A direct `SELECT` on `pgboss.job`.
**Why:** pg-boss can look up jobs by queue but has no way to list failed jobs across all queues. This is the one place the app depends on its internal schema.
**Rejected:** A separate failure table, which could drift from the real job state.

## Event times and tickets are shown in India time

**Chose:** Store UTC, and read form input as `+05:30` regardless of the browser or server timezone.
**Why:** Vercel runs in UTC, and everyone using this is on one campus.
**Rejected:** Per-user timezones, which multi-college support would need and this project doesn't.

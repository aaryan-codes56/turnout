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

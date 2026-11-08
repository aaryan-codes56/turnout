# Turnout

Every club event. One tap to get in.

Turnout is a club and event platform for a college campus. Clubs publish events, students register and get a QR ticket, and volunteers scan tickets at the door.

**Status:** Phase 0 (foundation). Google sign-in restricted to college email domains works; clubs and events come next.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Drizzle ORM, Better Auth, Zod, Vitest, and GitHub Actions.

Reasoning behind the main choices is in [docs/decisions.md](docs/decisions.md).

## Run it locally

You need Node 26, pnpm 12 and Docker.

```bash
pnpm install
cp .env.example .env          # then fill in the values below
pnpm db:up                    # Postgres on localhost:5434
pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

In `.env`, set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and the two Google values.

### Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Under **Google Auth Platform**, set up the consent screen with audience **External**.
3. Create an OAuth client of type **Web application**.
4. Add the authorized redirect URI `http://localhost:3000/api/auth/callback/google`.
5. Copy the client ID and secret into `.env`.

While the app is in Testing mode, only accounts listed as test users can sign in.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the web app |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Generate route types and run `tsc` |
| `pnpm test` | Run all tests (integration tests need `pnpm db:up`) |
| `pnpm test:unit` | Run unit tests only, no database needed |
| `pnpm build` | Production build |
| `pnpm db:up` / `pnpm db:down` | Start or stop local Postgres |
| `pnpm db:generate` | Create a migration from `schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the database |

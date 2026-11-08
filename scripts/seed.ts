// Demo data for local development. Everything is flagged is_test = true, so it
// can never count toward real usage numbers. Safe to run more than once.

import { eq } from "drizzle-orm";

import { clubMemberships, clubs, users } from "../src/server/db/schema";
import { databaseUrl, db, pool } from "./script-db";

const demoUsers = [
  { name: "Ananya Sharma", email: "ananya.sharma@seed.turnout.invalid" },
  { name: "Rohan Mehta", email: "rohan.mehta@seed.turnout.invalid" },
  { name: "Priya Nair", email: "priya.nair@seed.turnout.invalid" },
  { name: "Kabir Singh", email: "kabir.singh@seed.turnout.invalid" },
  { name: "Meera Iyer", email: "meera.iyer@seed.turnout.invalid" },
];

type DemoRole = "OWNER" | "ADMIN" | "VOLUNTEER";

const demoClubs: {
  slug: string;
  name: string;
  description: string;
  status: "PENDING" | "ACTIVE";
  requester: string;
  members: [string, DemoRole][];
}[] = [
  {
    slug: "demo-robotics-society",
    name: "Robotics Society",
    description:
      "We build line followers and battle bots, and run workshops for first-years every semester.",
    status: "ACTIVE",
    requester: demoUsers[0].email,
    members: [
      [demoUsers[0].email, "OWNER"],
      [demoUsers[1].email, "ADMIN"],
      [demoUsers[2].email, "VOLUNTEER"],
    ],
  },
  {
    slug: "demo-open-mic-collective",
    name: "Open Mic Collective",
    description:
      "Poetry, stand-up and acoustic sets on the lawns, open to anyone who wants the mic for five minutes.",
    status: "ACTIVE",
    requester: demoUsers[3].email,
    members: [
      [demoUsers[3].email, "OWNER"],
      [demoUsers[2].email, "ADMIN"],
    ],
  },
  {
    slug: "demo-chess-circle",
    name: "Chess Circle",
    description:
      "Weekly blitz nights and an inter-batch tournament. Boards provided, beginners welcome.",
    status: "PENDING",
    requester: demoUsers[4].email,
    members: [],
  },
];

async function main() {
  const { hostname } = new URL(databaseUrl as string);
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`Refusing to seed a non-local database (${hostname}).`);
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values(demoUsers.map((u) => ({ ...u, emailVerified: true, isTest: true })))
      .onConflictDoNothing({ target: users.email });

    const seededUsers = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.isTest, true));
    const idOf = new Map(seededUsers.map((u) => [u.email, u.id]));
    const userId = (email: string) => idOf.get(email) as string;

    for (const { requester, members, ...club } of demoClubs) {
      await tx
        .insert(clubs)
        .values({ ...club, createdBy: userId(requester), isTest: true })
        .onConflictDoNothing({ target: clubs.slug });
      const [{ id: clubId }] = await tx
        .select({ id: clubs.id })
        .from(clubs)
        .where(eq(clubs.slug, club.slug));

      for (const [email, role] of members) {
        await tx
          .insert(clubMemberships)
          .values({ clubId, userId: userId(email), role })
          .onConflictDoNothing();
      }
    }
  });
  console.log(
    `Seeded ${demoUsers.length} users and ${demoClubs.length} clubs (is_test = true).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

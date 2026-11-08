// Demo data for local development. Everything is flagged is_test = true, so it
// can never count toward real usage numbers. Safe to run more than once.

import { eq } from "drizzle-orm";

import {
  clubMemberships,
  clubs,
  events,
  registrations,
  users,
} from "../src/server/db/schema";
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

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number, hour = 12.5) =>
  new Date(Math.floor(Date.now() / DAY) * DAY + days * DAY + hour * 60 * 60 * 1000);

const demoEvents = [
  {
    club: "demo-robotics-society",
    slug: "demo-line-follower-workshop",
    title: "Line Follower Workshop",
    descriptionMd:
      "Build a line-following robot in one evening.\n\n- Kits provided\n- No soldering experience needed\n- Teams of **two**",
    venue: "Lab 204, Academic Block",
    startsIn: 4,
    capacity: 40,
    pricePaise: 0,
    status: "PUBLISHED" as const,
    attendees: 3,
    checkedIn: 0,
  },
  {
    club: "demo-open-mic-collective",
    slug: "demo-winter-open-mic",
    title: "Winter Open Mic",
    descriptionMd:
      "Five minutes, one microphone, the whole lawn listening.\n\nSign up on the night or just come to watch.",
    venue: "Central Lawn",
    startsIn: 9,
    capacity: 150,
    pricePaise: 4900,
    status: "PUBLISHED" as const,
    attendees: 0,
    checkedIn: 0,
  },
  {
    club: "demo-robotics-society",
    slug: "demo-battle-bots-finale",
    title: "Battle Bots Finale",
    descriptionMd: "The season's last match, and the trophy handover.",
    venue: "Sports Complex",
    startsIn: -12,
    capacity: 80,
    pricePaise: 0,
    status: "COMPLETED" as const,
    attendees: 5,
    checkedIn: 4,
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

    for (const { club, startsIn, attendees, checkedIn, ...event } of demoEvents) {
      const [{ id: clubId }] = await tx
        .select({ id: clubs.id })
        .from(clubs)
        .where(eq(clubs.slug, club));
      const startsAt = inDays(startsIn);
      const [created] = await tx
        .insert(events)
        .values({
          ...event,
          clubId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
          registrationOpensAt: inDays(startsIn - 14),
          registrationClosesAt: startsAt,
          seatsTaken: attendees,
          isTest: true,
        })
        .onConflictDoNothing({ target: events.slug })
        .returning({ id: events.id });
      if (!created) continue;

      for (const [index, user] of demoUsers.slice(0, attendees).entries()) {
        await tx.insert(registrations).values({
          eventId: created.id,
          userId: userId(user.email),
          status: "CONFIRMED",
          checkedInAt: index < checkedIn ? startsAt : null,
        });
      }
    }
  });
  console.log(
    `Seeded ${demoUsers.length} users, ${demoClubs.length} clubs and ${demoEvents.length} events (is_test = true).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

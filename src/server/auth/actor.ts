import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { clubMemberships, users } from "@/server/db/schema";

import type { Actor } from "./permissions";

/** Reads roles fresh from the database, so a demotion applies immediately. */
export async function loadActor(userId: string): Promise<Actor | null> {
  const [user] = await db
    .select({ id: users.id, platformRole: users.platformRole })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const memberships = await db
    .select({ clubId: clubMemberships.clubId, role: clubMemberships.role })
    .from(clubMemberships)
    .where(eq(clubMemberships.userId, userId));

  return { ...user, memberships };
}

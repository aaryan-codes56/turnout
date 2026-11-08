// Creates the first super admin, which the app can't do because promoting
// someone requires already being one. Usage: pnpm admin:promote <email>

import { eq } from "drizzle-orm";

import { auditLogs, users } from "../src/server/db/schema";
import { db, pool } from "./script-db";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: pnpm admin:promote <email>");

  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ platformRole: "SUPER_ADMIN" })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    if (!user) {
      throw new Error(`No account uses ${email}. Sign in once first.`);
    }
    await tx.insert(auditLogs).values({
      actorId: null,
      action: "platform.role_changed",
      entityType: "user",
      entityId: user.id,
      metadata: { email, to: "SUPER_ADMIN", source: "command line" },
    });
  });
  console.log(`${email} is now a super admin.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

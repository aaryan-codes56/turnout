import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/lib/env";
import { db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

import { applyPendingInvites } from "@/server/services/members";

import { allowedEmailDomains } from "./allowed-domains";
import { checkSignInIdentity } from "./email-domain";

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
  advanced: { database: { generateId: "uuid" } },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Students often have a personal account signed in too, so always ask.
      prompt: "select_account",
    },
  },
  user: {
    // Runs on the server for new users, account links and every returning
    // Google sign-in, using the email Google just returned. See decisions.md.
    validateUserInfo: ({ user }) =>
      checkSignInIdentity(user, allowedEmailDomains),
    // input: false means no client request can ever set these.
    additionalFields: {
      rollNumber: { type: "string", required: false, input: false },
      platformRole: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false,
      },
      isTest: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Every sign-in, not only the first, so an invite that lost a race
        // with signing up is still picked up next time. See decisions.md.
        after: async (session) => {
          try {
            await applyPendingInvites(session.userId);
          } catch (error) {
            // A broken invite shouldn't stop someone from signing in.
            console.error("Failed to apply pending club invites", error);
          }
        },
      },
    },
  },
  plugins: [nextCookies()], // Must stay last.
});

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { UnauthenticatedError } from "@/server/errors";

import { loadActor } from "./actor";
import { allowedEmailDomains } from "./allowed-domains";
import { auth } from "./auth";
import { isAllowedEmail } from "./email-domain";
import type { Actor } from "./permissions";

/**
 * The signed-in user, or null.
 *
 * The domain check repeats here so removing a domain from
 * ALLOWED_EMAIL_DOMAINS also cuts off sessions that already exist, instead of
 * waiting for them to expire.
 */
export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAllowedEmail(session.user.email, allowedEmailDomains)) {
    return null;
  }
  return session.user;
}

export async function getCurrentActor(): Promise<Actor | null> {
  const user = await getCurrentUser();
  return user ? loadActor(user.id) : null;
}

/** For pages: sends signed-out visitors to the sign-in page. */
export async function requireActorOrRedirect(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/sign-in");
  return actor;
}

/** For server actions: reports signed-out callers as a form error. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

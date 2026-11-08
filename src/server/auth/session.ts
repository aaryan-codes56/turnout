import { headers } from "next/headers";

import { allowedEmailDomains, auth } from "./auth";
import { isAllowedEmail } from "./email-domain";

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

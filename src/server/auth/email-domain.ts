export const SIGN_IN_ERROR = {
  domainNotAllowed: "domain_not_allowed",
  emailNotVerified: "email_not_verified",
} as const;

export function parseAllowedDomains(raw: string): string[] {
  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
}

/** Returns the lowercased domain, or null if this isn't a single-@ address. */
export function getEmailDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  return local && domain ? domain : null;
}

/**
 * Exact match on purpose. A suffix check would also accept
 * evil.nst.rishihood.edu.in, or fakenst.rishihood.edu.in.
 */
export function isAllowedEmail(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const domain = getEmailDomain(email);
  return domain !== null && allowedDomains.includes(domain);
}

/** The sign-in policy: a verified email on an allowed domain. */
export function checkSignInIdentity(
  identity: { email?: string | null; emailVerified?: boolean | null },
  allowedDomains: readonly string[],
): { error: string; errorDescription: string } | undefined {
  if (!identity.email || !isAllowedEmail(identity.email, allowedDomains)) {
    return {
      error: SIGN_IN_ERROR.domainNotAllowed,
      errorDescription: "This email domain is not allowed.",
    };
  }
  if (identity.emailVerified !== true) {
    return {
      error: SIGN_IN_ERROR.emailNotVerified,
      errorDescription: "Google has not verified this email address.",
    };
  }
  return undefined;
}

import { env } from "@/lib/env";

import { parseAllowedDomains } from "./email-domain";

export const allowedEmailDomains = parseAllowedDomains(
  env.ALLOWED_EMAIL_DOMAINS,
);

import { z } from "zod";

// Copying .env.example leaves blank values, which should count as "not set".
const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const required = z.preprocess(blankToUndefined, z.string().min(1));
const optional = z.preprocess(blankToUndefined, z.string().min(1).optional());
const secret = z.preprocess(blankToUndefined, z.string().min(32));

const envSchema = z.object({
  DATABASE_URL: required,
  BETTER_AUTH_SECRET: secret,
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,
  ALLOWED_EMAIL_DOMAINS: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("nst.rishihood.edu.in,rishihood.edu.in"),
  ),
  APP_URL: z.preprocess(blankToUndefined, z.url()),
  QR_SIGNING_SECRET: secret,

  // Free events work without these. Paid events and email need them.
  RAZORPAY_KEY_ID: optional,
  RAZORPAY_KEY_SECRET: optional,
  RAZORPAY_WEBHOOK_SECRET: optional,
  GMAIL_USER: optional,
  GMAIL_APP_PASSWORD: optional,
  EMAIL_FROM: optional,
  SENTRY_DSN: optional,
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return result.data;
}

export const env = loadEnv();

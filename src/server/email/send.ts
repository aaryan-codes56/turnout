import { render } from "@react-email/render";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { ReactElement } from "react";

import { brand } from "@/lib/brand";
import { env } from "@/lib/env";
import { db } from "@/server/db/client";
import { sentEmails } from "@/server/db/schema";
import { logger } from "@/server/logger";

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType: string;
  /** Lets the HTML show this file inline with <img src="cid:..."> */
  cid?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  body: ReactElement;
  attachments?: EmailAttachment[];
};

function createTransport() {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
}

const transport = createTransport();

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!transport) {
    // In production this fails the job, so it shows up on the failed jobs page.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Email isn't configured: set GMAIL_USER and GMAIL_APP_PASSWORD.");
    }
    logger.warn({ to: message.to, subject: message.subject }, "Email not configured, skipping send");
    return;
  }

  await transport.sendMail({
    from: env.EMAIL_FROM ?? `"${brand.name}" <${env.GMAIL_USER}>`,
    to: message.to,
    subject: message.subject,
    html: await render(message.body),
    text: await render(message.body, { plainText: true }),
    attachments: message.attachments,
  });
}

/**
 * Sends at most once per key, so a job that retries halfway through a list
 * carries on from where it stopped instead of emailing people twice.
 */
export async function sendEmailOnce(
  key: string,
  message: EmailMessage,
): Promise<boolean> {
  const [alreadySent] = await db
    .select({ key: sentEmails.key })
    .from(sentEmails)
    .where(eq(sentEmails.key, key));
  if (alreadySent) return false;

  await sendEmail(message);
  await db.insert(sentEmails).values({ key }).onConflictDoNothing();
  return true;
}

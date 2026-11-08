import { createHash } from "node:crypto";

export const JOBS = {
  sendTicketEmail: "send-ticket-email",
  sendCancellationNotice: "send-cancellation-notice",
  eventReminder: "event-reminder",
  expireHoldsAndReconcile: "expire-holds-and-reconcile",
  refundRegistration: "refund-registration",
  postEventSummary: "post-event-summary",
  metricsSnapshot: "metrics-snapshot",
  completeEndedEvents: "complete-ended-events",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export type JobPayloads = {
  [JOBS.sendTicketEmail]: { registrationId: string };
  [JOBS.sendCancellationNotice]: { registrationId: string };
  [JOBS.eventReminder]: {
    eventId: string;
    kind: "24h" | "2h";
    startsAt: string;
  };
  [JOBS.expireHoldsAndReconcile]: Record<string, never>;
  [JOBS.refundRegistration]: {
    registrationId: string;
    reason: "admin" | "event_cancelled" | "late_payment";
  };
  [JOBS.postEventSummary]: { eventId: string; endsAt: string };
  [JOBS.metricsSnapshot]: Record<string, never>;
  [JOBS.completeEndedEvents]: Record<string, never>;
};

/** Every job retries with exponential backoff, then stays visible as failed. */
export const RETRY_POLICY = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
} as const;

export const CRON_SCHEDULES = [
  { name: JOBS.expireHoldsAndReconcile, cron: "* * * * *" },
  { name: JOBS.completeEndedEvents, cron: "*/5 * * * *" },
  { name: JOBS.metricsSnapshot, cron: "30 18 * * *" }, // Midnight in India.
] as const;

/**
 * Turns a business key into a stable job id. pg-boss ignores a second job
 * with an id it has already seen, so this is what makes enqueueing idempotent.
 */
export function jobIdFor(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

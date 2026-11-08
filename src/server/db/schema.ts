import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  CustomQuestion,
  RegistrationAnswers,
} from "../../lib/event-questions";

export const platformRole = pgEnum("platform_role", ["USER", "SUPER_ADMIN"]);
export const clubStatus = pgEnum("club_status", [
  "PENDING",
  "ACTIVE",
  "ARCHIVED",
]);
export const clubRole = pgEnum("club_role", ["OWNER", "ADMIN", "VOLUNTEER"]);

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  name: text().notNull(),
  image: text(),
  rollNumber: text(),
  platformRole: platformRole().notNull().default("USER"),
  isTest: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// sessions, accounts and verifications have the columns Better Auth requires.
// See docs/decisions.md.

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("accounts_user_id_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

export const clubs = pgTable(
  "clubs",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    description: text().notNull(),
    logoUrl: text(),
    status: clubStatus().notNull().default("PENDING"),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    isTest: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("clubs_created_by_idx").on(table.createdBy),
    index("clubs_status_idx").on(table.status),
  ],
);

export const clubMemberships = pgTable(
  "club_memberships",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clubId: uuid()
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    role: clubRole().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Also serves as the (user_id, club_id) uniqueness rule and user_id index.
    primaryKey({ columns: [table.userId, table.clubId] }),
    index("club_memberships_club_id_idx").on(table.clubId),
  ],
);

export const clubInvites = pgTable(
  "club_invites",
  {
    id: uuid().primaryKey().defaultRandom(),
    clubId: uuid()
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: clubRole().notNull(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("club_invites_one_pending_idx")
      .on(table.clubId, table.email)
      .where(sql`${table.acceptedAt} IS NULL`),
    index("club_invites_email_idx").on(table.email),
    index("club_invites_invited_by_idx").on(table.invitedBy),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Null when the change came from a command-line script. Kept if the user
    // is deleted, because the history should outlive the account.
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_logs_actor_id_idx").on(table.actorId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt.desc()),
  ],
);

export const eventStatus = pgEnum("event_status", [
  "DRAFT",
  "PUBLISHED",
  "COMPLETED",
  "CANCELLED",
]);
export const registrationStatus = pgEnum("registration_status", [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
export const paymentStatus = pgEnum("payment_status", [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
]);
export const paymentMode = pgEnum("payment_mode", ["TEST", "LIVE"]);

export const events = pgTable(
  "events",
  {
    id: uuid().primaryKey().defaultRandom(),
    clubId: uuid()
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    slug: text().notNull().unique(),
    title: text().notNull(),
    descriptionMd: text().notNull(),
    coverUrl: text(),
    venue: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    capacity: integer().notNull(),
    seatsTaken: integer().notNull().default(0),
    pricePaise: integer().notNull().default(0),
    status: eventStatus().notNull().default("DRAFT"),
    registrationOpensAt: timestamp({ withTimezone: true }).notNull(),
    registrationClosesAt: timestamp({ withTimezone: true }).notNull(),
    checkinOpensBeforeMinutes: integer().notNull().default(120),
    customQuestions: jsonb()
      .$type<CustomQuestion[]>()
      .notNull()
      .default([]),
    isTest: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("events_club_id_idx").on(table.clubId),
    index("events_status_starts_at_idx").on(table.status, table.startsAt),
    // The application reserves seats atomically. This is the backstop that
    // makes overselling impossible even if that code is ever wrong.
    check(
      "events_seats_within_capacity",
      sql`${table.seatsTaken} >= 0 AND ${table.seatsTaken} <= ${table.capacity}`,
    ),
    check("events_ends_after_start", sql`${table.endsAt} > ${table.startsAt}`),
    check("events_price_not_negative", sql`${table.pricePaise} >= 0`),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: registrationStatus().notNull(),
    answers: jsonb().$type<RegistrationAnswers>().notNull().default({}),
    holdExpiresAt: timestamp({ withTimezone: true }),
    checkedInAt: timestamp({ withTimezone: true }),
    checkedInBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("registrations_one_active_idx")
      .on(table.eventId, table.userId)
      .where(sql`${table.status} IN ('PENDING_PAYMENT', 'CONFIRMED')`),
    index("registrations_event_status_idx").on(table.eventId, table.status),
    index("registrations_user_id_idx").on(table.userId),
    index("registrations_checked_in_by_idx").on(table.checkedInBy),
    index("registrations_expiring_holds_idx")
      .on(table.holdExpiresAt)
      .where(sql`${table.status} = 'PENDING_PAYMENT'`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    registrationId: uuid()
      .notNull()
      .references(() => registrations.id, { onDelete: "restrict" }),
    razorpayOrderId: text().notNull().unique(),
    razorpayPaymentId: text(),
    razorpayRefundId: text(),
    amountPaise: integer().notNull(),
    status: paymentStatus().notNull().default("CREATED"),
    mode: paymentMode().notNull(),
    raw: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("payments_registration_id_idx").on(table.registrationId),
    index("payments_razorpay_payment_id_idx").on(table.razorpayPaymentId),
  ],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp({ withTimezone: true }),
});

export const metricsSnapshots = pgTable("metrics_snapshots", {
  date: date({ mode: "string" }).primaryKey(),
  activeClubs: integer().notNull(),
  events: integer().notNull(),
  checkins: integer().notNull(),
  uniqueAttendees: integer().notNull(),
});

// One row per email that has gone out, so a retried job can't send it twice.
export const sentEmails = pgTable("sent_emails", {
  key: text().primaryKey(),
  sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().primaryKey(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull(),
  },
  (table) => [index("rate_limits_window_start_idx").on(table.windowStart)],
);

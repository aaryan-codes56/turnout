import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

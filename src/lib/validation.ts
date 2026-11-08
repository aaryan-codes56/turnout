import { z } from "zod";

import { customQuestionsSchema } from "@/lib/event-questions";
import { parseIstInput } from "@/lib/time";

const clubRoleSchema = z.enum(["OWNER", "ADMIN", "VOLUNTEER"], {
  error: "Choose a role.",
});
const idSchema = z.uuid({ error: "That link is no longer valid." });
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }));

export const requestClubSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Club name needs at least 3 characters.")
    .max(80, "Club name can be at most 80 characters."),
  description: z
    .string()
    .trim()
    .min(20, "Description needs at least 20 characters.")
    .max(2000, "Description can be at most 2000 characters."),
  logoUrl: z
    .url({
      protocol: /^https$/,
      error: "Logo must be an https:// image link.",
    })
    .or(z.literal(""))
    .optional()
    .transform((value) => value || null),
});
export type RequestClubInput = z.output<typeof requestClubSchema>;

export const clubIdSchema = z.object({ clubId: idSchema });

export const inviteMemberSchema = z.object({
  clubId: idSchema,
  email: emailSchema,
  role: clubRoleSchema,
});
export type InviteMemberInput = z.output<typeof inviteMemberSchema>;

export const changeMemberRoleSchema = z.object({
  clubId: idSchema,
  userId: idSchema,
  role: clubRoleSchema,
});
export type ChangeMemberRoleInput = z.output<typeof changeMemberRoleSchema>;

export const removeMemberSchema = z.object({
  clubId: idSchema,
  userId: idSchema,
});
export type RemoveMemberInput = z.output<typeof removeMemberSchema>;

export const revokeInviteSchema = z.object({
  clubId: idSchema,
  inviteId: idSchema,
});
export type RevokeInviteInput = z.output<typeof revokeInviteSchema>;

export const setPlatformRoleSchema = z.object({
  email: emailSchema,
  role: z.enum(["USER", "SUPER_ADMIN"], { error: "Choose a role." }),
});
export type SetPlatformRoleInput = z.output<typeof setPlatformRoleSchema>;

export const pageSchema = z.coerce.number().int().min(1).catch(1);

const dateTimeInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.")
  .transform(parseIstInput);
const optionalDateTimeInput = z
  .literal("")
  .transform(() => null)
  .or(dateTimeInput);
const optionalHttpsUrl = z
  .url({ protocol: /^https$/, error: "Use an https:// image link." })
  .or(z.literal(""))
  .optional()
  .transform((value) => value || null);

export const eventFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Title needs at least 3 characters.")
      .max(120, "Title can be at most 120 characters."),
    descriptionMd: z
      .string()
      .trim()
      .min(10, "Description needs at least 10 characters.")
      .max(10_000, "Description can be at most 10,000 characters."),
    coverUrl: optionalHttpsUrl,
    venue: z
      .string()
      .trim()
      .min(2, "Enter a venue.")
      .max(160, "Venue can be at most 160 characters."),
    startsAt: dateTimeInput,
    endsAt: dateTimeInput,
    capacity: z.coerce
      .number({ error: "Enter a capacity." })
      .int("Capacity must be a whole number.")
      .min(1, "Capacity must be at least 1.")
      .max(100_000, "Capacity can be at most 100,000."),
    priceRupees: z.coerce
      .number({ error: "Enter a price, or 0 for free." })
      .min(0, "Price can't be negative.")
      .max(100_000, "Price can be at most ₹100,000."),
    registrationOpensAt: optionalDateTimeInput,
    registrationClosesAt: optionalDateTimeInput,
    checkinOpensBeforeHours: z.coerce
      .number({ error: "Enter how early check-in opens." })
      .min(0, "Check-in hours can't be negative.")
      .max(48, "Check-in can open at most 48 hours early."),
    customQuestions: z
      .string()
      .transform((text, context) => {
        try {
          return JSON.parse(text || "[]") as unknown;
        } catch {
          context.addIssue({ code: "custom", message: "Those questions couldn't be read." });
          return z.NEVER;
        }
      })
      .pipe(customQuestionsSchema),
  })
  .refine((form) => form.endsAt > form.startsAt, {
    error: "The event must end after it starts.",
  })
  .refine((form) => form.priceRupees === 0 || form.priceRupees >= 1, {
    error: "Paid tickets must cost at least ₹1.",
  })
  .refine(
    (form) =>
      !form.registrationOpensAt ||
      form.registrationOpensAt < (form.registrationClosesAt ?? form.startsAt),
    { error: "Registration must open before it closes." },
  )
  .refine(
    (form) => !form.registrationClosesAt || form.registrationClosesAt <= form.endsAt,
    { error: "Registration must close before the event ends." },
  )
  .transform(({ priceRupees, checkinOpensBeforeHours, ...form }) => ({
    ...form,
    pricePaise: Math.round(priceRupees * 100),
    checkinOpensBeforeMinutes: Math.round(checkinOpensBeforeHours * 60),
  }));
export type EventFormInput = z.output<typeof eventFormSchema>;

export const eventIdSchema = z.object({ eventId: idSchema });
export const registrationIdSchema = z.object({ registrationId: idSchema });

export const registerSchema = z.object({
  answers: z.record(z.string(), z.unknown()).default({}),
  rollNumber: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/_-]{3,30}$/, "Enter your roll number as printed on your ID.")
    .optional(),
});
export type RegisterInput = z.output<typeof registerSchema>;

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

export const scanSchema = z.object({ payload: z.string().min(1).max(300) });
export const manualCheckinSchema = z.object({ registrationId: idSchema });
export const attendeeSearchSchema = z.string().trim().max(100).catch("");
export const attendeeStatusSchema = z
  .enum(["PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "EXPIRED", "REFUNDED"])
  .optional()
  .catch(undefined);

export const retryJobSchema = z.object({
  name: z.string().min(1).max(60),
  id: idSchema,
});

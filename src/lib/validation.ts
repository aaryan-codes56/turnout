import { z } from "zod";

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

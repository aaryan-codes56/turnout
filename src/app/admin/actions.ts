"use server";

import { revalidatePath } from "next/cache";

import type { FormAction } from "@/lib/action-result";
import { clubIdSchema, setPlatformRoleSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/run-action";
import { setPlatformRole } from "@/server/services/admin";
import { approveClub, archiveClub } from "@/server/services/clubs";

export const approveClubAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { clubId } = clubIdSchema.parse(Object.fromEntries(formData));
    await approveClub(await requireActor(), clubId);
    revalidatePath("/admin");
  });

export const archiveClubAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { clubId } = clubIdSchema.parse(Object.fromEntries(formData));
    await archiveClub(await requireActor(), clubId);
    revalidatePath("/admin");
  });

export const setPlatformRoleAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const input = setPlatformRoleSchema.parse(Object.fromEntries(formData));
    await setPlatformRole(await requireActor(), input);
    revalidatePath("/admin/super-admins");
    return input.role === "SUPER_ADMIN"
      ? `${input.email} is now a super admin.`
      : `${input.email} is no longer a super admin.`;
  });

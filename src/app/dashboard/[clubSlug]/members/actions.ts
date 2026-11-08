"use server";

import { revalidatePath } from "next/cache";

import type { FormAction } from "@/lib/action-result";
import {
  changeMemberRoleSchema,
  inviteMemberSchema,
  removeMemberSchema,
  revokeInviteSchema,
} from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/run-action";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvite,
} from "@/server/services/members";

const MEMBERS_PATH = "/dashboard/[clubSlug]/members";

export const inviteMemberAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const input = inviteMemberSchema.parse(Object.fromEntries(formData));
    const outcome = await inviteMember(await requireActor(), input);
    revalidatePath(MEMBERS_PATH, "page");
    return outcome === "added"
      ? `Added ${input.email} to the club.`
      : `Invited ${input.email}. They'll join when they first sign in.`;
  });

export const changeMemberRoleAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const input = changeMemberRoleSchema.parse(Object.fromEntries(formData));
    await changeMemberRole(await requireActor(), input);
    revalidatePath(MEMBERS_PATH, "page");
  });

export const removeMemberAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const input = removeMemberSchema.parse(Object.fromEntries(formData));
    await removeMember(await requireActor(), input);
    revalidatePath(MEMBERS_PATH, "page");
  });

export const revokeInviteAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const input = revokeInviteSchema.parse(Object.fromEntries(formData));
    await revokeInvite(await requireActor(), input);
    revalidatePath(MEMBERS_PATH, "page");
  });

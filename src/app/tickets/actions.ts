"use server";

import { revalidatePath } from "next/cache";

import type { FormAction } from "@/lib/action-result";
import { registrationIdSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/run-action";
import { cancelOwnRegistration } from "@/server/services/registrations";

export const cancelRegistrationAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { registrationId } = registrationIdSchema.parse(Object.fromEntries(formData));
    await cancelOwnRegistration(await requireActor(), registrationId);
    revalidatePath("/tickets");
  });

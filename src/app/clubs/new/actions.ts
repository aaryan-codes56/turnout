"use server";

import { redirect } from "next/navigation";

import type { FormAction } from "@/lib/action-result";
import { requestClubSchema } from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/run-action";
import { requestClub } from "@/server/services/clubs";

export const requestClubAction: FormAction = async (_previous, formData) => {
  const result = await runAction(async () => {
    const input = requestClubSchema.parse(Object.fromEntries(formData));
    await requestClub(await requireActor(), input);
  });
  if (result.status === "success") redirect("/dashboard");
  return result;
};

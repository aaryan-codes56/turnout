"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormAction } from "@/lib/action-result";
import {
  clubIdSchema,
  eventFormSchema,
  eventIdSchema,
  registrationIdSchema,
} from "@/lib/validation";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/run-action";
import {
  cancelEvent,
  createEvent,
  publishEvent,
  setEventTestFlag,
  updateEvent,
} from "@/server/services/events";
import { requestRefund } from "@/server/services/payments";

const clubSlugSchema = z.object({ clubSlug: z.string().min(1).max(100) });
const DASHBOARD_PATH = "/dashboard/[clubSlug]";

function eventPath(clubSlug: string, eventId: string) {
  return `/dashboard/${clubSlug}/events/${eventId}`;
}

export const createEventAction: FormAction = async (_previous, formData) => {
  let destination = "";
  const result = await runAction(async () => {
    const raw = Object.fromEntries(formData);
    const input = eventFormSchema.parse(raw);
    const { clubId } = clubIdSchema.parse(raw);
    const { clubSlug } = clubSlugSchema.parse(raw);
    const event = await createEvent(await requireActor(), clubId, input);
    destination = eventPath(clubSlug, event.id);
  });
  if (result.status === "success") redirect(destination);
  return result;
};

export const updateEventAction: FormAction = async (_previous, formData) => {
  let destination = "";
  const result = await runAction(async () => {
    const raw = Object.fromEntries(formData);
    const input = eventFormSchema.parse(raw);
    const { eventId } = eventIdSchema.parse(raw);
    const { clubSlug } = clubSlugSchema.parse(raw);
    await updateEvent(await requireActor(), eventId, input);
    destination = eventPath(clubSlug, eventId);
  });
  if (result.status === "success") redirect(destination);
  return result;
};

export const publishEventAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { eventId } = eventIdSchema.parse(Object.fromEntries(formData));
    await publishEvent(await requireActor(), eventId);
    revalidatePath(DASHBOARD_PATH, "layout");
  });

export const cancelEventAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { eventId } = eventIdSchema.parse(Object.fromEntries(formData));
    await cancelEvent(await requireActor(), eventId);
    revalidatePath(DASHBOARD_PATH, "layout");
  });

export const refundRegistrationAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const { registrationId } = registrationIdSchema.parse(Object.fromEntries(formData));
    await requestRefund(await requireActor(), registrationId);
    revalidatePath(DASHBOARD_PATH, "layout");
    return "Refund started. It can take a moment to appear.";
  });

export const toggleEventTestAction: FormAction = async (_previous, formData) =>
  runAction(async () => {
    const raw = Object.fromEntries(formData);
    const { eventId } = eventIdSchema.parse(raw);
    await setEventTestFlag(await requireActor(), eventId, raw.isTest === "true");
    revalidatePath(DASHBOARD_PATH, "layout");
  });

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireActorOrRedirect } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { getScanPageEvent } from "@/server/services/checkin";

import { Scanner } from "./scanner";

export const metadata: Metadata = { title: "Scan tickets" };

export default async function ScanPage({ params }: PageProps<"/scan/[eventId]">) {
  const { eventId } = await params;
  const actor = await requireActorOrRedirect();
  const event = await getScanPageEvent(actor, eventId).catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!event) notFound();

  return <Scanner eventId={eventId} title={event.title} isOpen={event.isOpen} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventForm } from "@/components/event-form";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClubBySlug } from "@/server/services/clubs";

import { createEventAction } from "../actions";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({
  params,
}: PageProps<"/dashboard/[clubSlug]/events/new">) {
  const { clubSlug } = await params;
  const actor = await requireActorOrRedirect();
  const club = await getClubBySlug(clubSlug);
  if (!club || !can(actor, "event.create", { clubId: club.id })) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <p className="font-bold">{club.name}</p>
      <h1 className="font-heading text-6xl leading-none font-black">New event</h1>
      <p className="mt-3 text-lg">
        This saves a draft. Nothing is public until you publish it. All times
        are India time.
      </p>
      <EventForm
        action={createEventAction}
        hiddenFields={{ clubId: club.id, clubSlug: club.slug }}
        submitLabel="Save draft"
        priceLocked={false}
      />
    </main>
  );
}

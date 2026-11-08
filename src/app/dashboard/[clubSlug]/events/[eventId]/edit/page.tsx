import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventForm } from "@/components/event-form";
import { toIstInput } from "@/lib/time";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClubBySlug } from "@/server/services/clubs";
import { getEventById } from "@/server/services/events";

import { updateEventAction } from "../../actions";

export const metadata: Metadata = { title: "Edit event" };

export default async function EditEventPage({
  params,
}: PageProps<"/dashboard/[clubSlug]/events/[eventId]/edit">) {
  const { clubSlug, eventId } = await params;
  const actor = await requireActorOrRedirect();
  const [club, event] = await Promise.all([
    getClubBySlug(clubSlug),
    getEventById(eventId).catch(() => null),
  ]);
  if (
    !club ||
    !event ||
    event.clubId !== club.id ||
    !can(actor, "event.edit", { clubId: club.id })
  ) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <p className="font-bold">{club.name}</p>
      <h1 className="font-heading text-6xl leading-none font-black">Edit event</h1>
      <EventForm
        action={updateEventAction}
        hiddenFields={{ eventId: event.id, clubSlug: club.slug }}
        submitLabel="Save changes"
        priceLocked={event.seatsTaken > 0}
        defaults={{
          title: event.title,
          descriptionMd: event.descriptionMd,
          coverUrl: event.coverUrl ?? "",
          venue: event.venue,
          startsAt: toIstInput(event.startsAt),
          endsAt: toIstInput(event.endsAt),
          capacity: event.capacity,
          priceRupees: event.pricePaise / 100,
          registrationOpensAt: toIstInput(event.registrationOpensAt),
          registrationClosesAt: toIstInput(event.registrationClosesAt),
          checkinOpensBeforeHours: event.checkinOpensBeforeMinutes / 60,
          customQuestions: event.customQuestions,
        }}
      />
    </main>
  );
}

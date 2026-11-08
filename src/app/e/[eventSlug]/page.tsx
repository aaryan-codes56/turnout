import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Markdown } from "@/components/markdown";
import { RegisterPanel } from "@/components/register-panel";
import { formatEventTime, formatPrice } from "@/lib/time";
import { getCurrentActor } from "@/server/auth/session";
import { getPublicEventBySlug } from "@/server/services/events";
import {
  getOwnRegistration,
  getRollNumber,
} from "@/server/services/registrations";

export async function generateMetadata({
  params,
}: PageProps<"/e/[eventSlug]">): Promise<Metadata> {
  const { eventSlug } = await params;
  const row = await getPublicEventBySlug(eventSlug);
  if (!row) return {};
  const description = `${formatEventTime(row.event.startsAt, row.event.endsAt)} at ${row.event.venue}. Hosted by ${row.clubName}.`;
  return {
    title: row.event.title,
    description,
    openGraph: { title: row.event.title, description, type: "website" },
    twitter: { card: "summary_large_image" },
  };
}

function statusMessage(status: string, full: boolean): string | null {
  if (status === "CANCELLED") return "This event has been cancelled.";
  if (status === "COMPLETED") return "This event has ended.";
  if (full) return "This event is full.";
  return null;
}

export default async function EventPage({
  params,
}: PageProps<"/e/[eventSlug]">) {
  const { eventSlug } = await params;
  const row = await getPublicEventBySlug(eventSlug);
  if (!row) notFound();
  const { event, clubName, clubSlug } = row;

  const actor = await getCurrentActor();
  const [registration, rollNumber] = actor
    ? await Promise.all([
        getOwnRegistration(actor, event.id),
        getRollNumber(actor),
      ])
    : [null, null];

  const now = new Date();
  const seatsLeft = event.capacity - event.seatsTaken;
  const notice = statusMessage(event.status, seatsLeft <= 0);
  const windowMessage =
    now < event.registrationOpensAt
      ? "Registration hasn't opened yet."
      : now > event.registrationClosesAt
        ? "Registration has closed."
        : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-16 sm:px-6">
      {event.coverUrl && (
        // Clubs paste a cover link from anywhere; next/image needs an allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.coverUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="mb-6 aspect-[2/1] w-full rounded-xl object-cover"
        />
      )}
      <Link href={`/c/${clubSlug}`} className="font-bold underline-offset-4 hover:underline">
        {clubName}
      </Link>
      <h1 className="mt-2 font-heading text-6xl leading-[0.95] font-black sm:text-7xl">
        {event.title}
      </h1>
      <dl className="mt-6 grid gap-1 text-lg">
        <dd>{formatEventTime(event.startsAt, event.endsAt)}</dd>
        <dd>{event.venue}</dd>
        <dd className="font-bold">
          {formatPrice(event.pricePaise)}
          {event.status === "PUBLISHED" && seatsLeft > 0
            ? `, ${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left`
            : ""}
        </dd>
      </dl>
      <a
        href={`/e/${event.slug}/calendar.ics`}
        className="mt-2 inline-flex h-11 items-center font-bold underline underline-offset-4"
      >
        Add to calendar
      </a>

      <section className="mt-6">
        {registration?.status === "CONFIRMED" ? (
          <div>
            <p className="text-xl font-bold">You&apos;re registered.</p>
            <Link
              href="/tickets"
              className="mt-1 inline-flex h-11 items-center font-bold underline underline-offset-4"
            >
              View your ticket
            </Link>
          </div>
        ) : notice ? (
          <p className="text-xl font-bold">{notice}</p>
        ) : windowMessage ? (
          <p className="text-xl font-bold">{windowMessage}</p>
        ) : (
          <RegisterPanel
            eventId={event.id}
            eventSlug={event.slug}
            eventTitle={event.title}
            questions={event.customQuestions}
            signedIn={actor !== null}
            needsRollNumber={actor !== null && !rollNumber}
            isPaid={event.pricePaise > 0}
            priceLabel={formatPrice(event.pricePaise)}
            resumingPayment={registration?.status === "PENDING_PAYMENT"}
          />
        )}
      </section>

      <section className="mt-10">
        <Markdown source={event.descriptionMd} />
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClubLogo } from "@/components/club-logo";
import { formatEventTime, formatPrice } from "@/lib/time";
import { getPublicClubBySlug } from "@/server/services/clubs";
import { listPublicClubEvents } from "@/server/services/events";

export async function generateMetadata({
  params,
}: PageProps<"/c/[clubSlug]">): Promise<Metadata> {
  const { clubSlug } = await params;
  const club = await getPublicClubBySlug(clubSlug);
  return club
    ? { title: club.name, description: club.description.slice(0, 160) }
    : {};
}

type ClubEvent = Awaited<ReturnType<typeof listPublicClubEvents>>["upcoming"][number];

function EventList({ items }: { items: ClubEvent[] }) {
  return (
    <ul className="mt-3 divide-y">
      {items.map((event) => (
        <li key={event.id} className="py-3">
          <Link href={`/e/${event.slug}`} className="text-lg font-bold hover:underline">
            {event.title}
          </Link>
          <p className="text-muted-foreground">
            {formatEventTime(event.startsAt, event.endsAt)}, {formatPrice(event.pricePaise)}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function ClubPage({
  params,
}: PageProps<"/c/[clubSlug]">) {
  const { clubSlug } = await params;
  const club = await getPublicClubBySlug(clubSlug);
  if (!club) notFound();
  const { upcoming, past } = await listPublicClubEvents(club.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <ClubLogo name={club.name} logoUrl={club.logoUrl} />
      <h1 className="mt-5 font-heading text-6xl leading-none font-black sm:text-7xl">
        {club.name}
      </h1>
      <p className="mt-5 max-w-prose text-lg leading-relaxed whitespace-pre-line">
        {club.description}
      </p>

      <h2 className="mt-12 font-heading text-4xl font-black">Upcoming events</h2>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Nothing scheduled right now.</p>
      ) : (
        <EventList items={upcoming} />
      )}

      {past.length > 0 && (
        <>
          <h2 className="mt-10 font-heading text-4xl font-black">Past events</h2>
          <EventList items={past} />
        </>
      )}
    </main>
  );
}

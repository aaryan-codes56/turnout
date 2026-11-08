import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { formatEventTime, formatPrice } from "@/lib/time";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClubBySlug } from "@/server/services/clubs";
import { listDashboardEvents } from "@/server/services/events";

export const metadata: Metadata = { title: "Club dashboard" };

const textLink =
  "inline-flex h-11 items-center font-bold underline-offset-4 hover:underline";

export default async function ClubDashboardPage({
  params,
}: PageProps<"/dashboard/[clubSlug]">) {
  const { clubSlug } = await params;
  const actor = await requireActorOrRedirect();
  const club = await getClubBySlug(clubSlug);
  if (!club || !can(actor, "club.viewDashboard", { clubId: club.id })) {
    notFound();
  }

  const scope = { clubId: club.id };
  const dashboardEvents = await listDashboardEvents(actor, club.id);
  const canManage = can(actor, "attendee.list", scope);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black">{club.name}</h1>
      {club.status !== "ACTIVE" && (
        <p className="mt-3 text-lg">
          This club is {club.status.toLowerCase()}, so it isn&apos;t public.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-5">
        {club.status === "ACTIVE" && (
          <Link href={`/c/${club.slug}`} className={textLink}>
            Public page
          </Link>
        )}
        {can(actor, "member.view", scope) && (
          <Link href={`/dashboard/${club.slug}/members`} className={textLink}>
            Members and roles
          </Link>
        )}
      </div>

      {can(actor, "event.create", scope) && club.status === "ACTIVE" && (
        <Link
          href={`/dashboard/${club.slug}/events/new`}
          className={cn(buttonVariants(), "mt-4 h-12 px-6 text-base")}
        >
          New event
        </Link>
      )}

      <h2 className="mt-10 font-heading text-4xl font-black">Events</h2>
      {dashboardEvents.length === 0 ? (
        <p className="mt-2 text-muted-foreground">No events yet.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {dashboardEvents.map((event) => (
            <li key={event.id} className="py-4">
              {canManage ? (
                <Link
                  href={`/dashboard/${club.slug}/events/${event.id}`}
                  className="text-lg font-bold hover:underline"
                >
                  {event.title}
                </Link>
              ) : (
                <p className="text-lg font-bold">{event.title}</p>
              )}
              <p className="text-muted-foreground">
                {formatEventTime(event.startsAt, event.endsAt)}
              </p>
              <p className="capitalize">{event.status.toLowerCase()}</p>
              {event.stats && (
                <p>
                  {event.stats.registrations} registered, {event.stats.checkins} checked in
                  {event.stats.revenuePaise > 0
                    ? `, ${formatPrice(event.stats.revenuePaise)} collected (test mode)`
                    : ""}
                </p>
              )}
              {event.status === "PUBLISHED" && (
                <Link href={`/scan/${event.id}`} className={textLink}>
                  Scan tickets
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

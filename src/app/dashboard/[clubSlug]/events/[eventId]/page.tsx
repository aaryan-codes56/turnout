import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { LiveCounter } from "@/components/live-counter";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateTime, formatEventTime, formatPrice } from "@/lib/time";
import { cn } from "@/lib/utils";
import { attendeeSearchSchema, attendeeStatusSchema } from "@/lib/validation";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listAttendees } from "@/server/services/attendees";
import { getCheckinCounts } from "@/server/services/checkin";
import { getClubBySlug } from "@/server/services/clubs";
import { getEventById } from "@/server/services/events";

import {
  cancelEventAction,
  publishEventAction,
  refundRegistrationAction,
  toggleEventTestAction,
} from "../actions";

export const metadata: Metadata = { title: "Event" };

const STATUSES = [
  ["CONFIRMED", "Confirmed"],
  ["PENDING_PAYMENT", "Awaiting payment"],
  ["CANCELLED", "Cancelled"],
  ["EXPIRED", "Expired"],
  ["REFUNDED", "Refunded"],
] as const;

export default async function DashboardEventPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[clubSlug]/events/[eventId]">) {
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
    !can(actor, "attendee.list", { clubId: club.id })
  ) {
    notFound();
  }

  const filters = await searchParams;
  const query = attendeeSearchSchema.parse(filters.q);
  const status = attendeeStatusSchema.parse(filters.status);
  const [attendees, counts] = await Promise.all([
    listAttendees(actor, event.id, { query, status }),
    getCheckinCounts(actor, event.id),
  ]);

  const editable = event.status === "DRAFT" || event.status === "PUBLISHED";
  const secondary = cn(buttonVariants({ variant: "outline" }), "h-11 px-4");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <Link
        href={`/dashboard/${club.slug}`}
        className="inline-flex h-11 items-center font-bold underline-offset-4 hover:underline"
      >
        {club.name}
      </Link>
      <h1 className="font-heading text-6xl leading-none font-black">{event.title}</h1>
      <p className="mt-3 text-lg">{formatEventTime(event.startsAt, event.endsAt)}</p>
      <p className="text-lg">
        {event.venue}, {formatPrice(event.pricePaise)}
      </p>
      <p className="mt-1 font-bold capitalize">
        {event.status.toLowerCase()}
        {event.isTest ? ", marked as test" : ""}
      </p>

      <div className="mt-5 flex flex-wrap items-start gap-2">
        {event.status === "DRAFT" && (
          <ActionForm action={publishEventAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <Button type="submit" className="h-11 px-5">
              Publish
            </Button>
          </ActionForm>
        )}
        {event.status !== "DRAFT" && (
          <Link href={`/e/${event.slug}`} className={secondary}>
            Public page
          </Link>
        )}
        {event.status === "PUBLISHED" && (
          <Link href={`/scan/${event.id}`} className={secondary}>
            Scan tickets
          </Link>
        )}
        {editable && (
          <Link href={`/dashboard/${club.slug}/events/${event.id}/edit`} className={secondary}>
            Edit
          </Link>
        )}
        <a href={`/dashboard/${club.slug}/events/${event.id}/attendees.csv`} className={secondary}>
          Export CSV
        </a>
        {can(actor, "event.markTest") && (
          <ActionForm action={toggleEventTestAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="isTest" value={String(!event.isTest)} />
            <Button type="submit" variant="ghost" className="h-11 px-4">
              {event.isTest ? "Count in metrics" : "Mark as test"}
            </Button>
          </ActionForm>
        )}
        {editable && (
          <ActionForm
            action={cancelEventAction}
            confirmMessage={
              event.pricePaise > 0
                ? `Cancel ${event.title} and refund everyone? This can't be undone.`
                : `Cancel ${event.title}? Attendees will be emailed. This can't be undone.`
            }
          >
            <input type="hidden" name="eventId" value={event.id} />
            <Button type="submit" variant="ghost" className="h-11 px-4 text-destructive">
              Cancel event
            </Button>
          </ActionForm>
        )}
      </div>

      <section className="mt-8">
        <LiveCounter eventId={event.id} initial={counts} />
      </section>

      <section className="mt-8">
        <h2 className="font-heading text-4xl font-black">Attendees</h2>
        <form className="mt-3 flex flex-wrap gap-2">
          <Input
            name="q"
            defaultValue={query}
            placeholder="Name, email or roll number"
            aria-label="Search attendees"
            className="h-11 min-w-48 flex-1"
          />
          <NativeSelect name="status" defaultValue={status ?? ""} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" className="h-11 px-4">
            Apply
          </Button>
        </form>

        {attendees.length === 0 ? (
          <p className="mt-4 text-muted-foreground">No attendees match.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {attendees.map((attendee) => (
              <li key={attendee.registrationId} className="flex flex-wrap items-center justify-between gap-x-3 py-3">
                <div className="min-w-0">
                  <p className="font-bold">{attendee.name}</p>
                  <p className="wrap-anywhere text-muted-foreground">
                    {attendee.rollNumber ? `${attendee.rollNumber}, ` : ""}
                    {attendee.email}
                  </p>
                  <p>
                    {attendee.checkedInAt
                      ? `Checked in ${formatDateTime(attendee.checkedInAt)}`
                      : (STATUSES.find(([value]) => value === attendee.status)?.[1] ?? attendee.status)}
                  </p>
                </div>
                {attendee.status === "CONFIRMED" && attendee.paymentStatus === "CAPTURED" && (
                  <ActionForm
                    action={refundRegistrationAction}
                    confirmMessage={`Refund ${attendee.name}?`}
                  >
                    <input type="hidden" name="registrationId" value={attendee.registrationId} />
                    <Button type="submit" variant="ghost" className="h-11 px-3">
                      Refund
                    </Button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

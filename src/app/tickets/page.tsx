import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatEventTime } from "@/lib/time";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listMyTickets } from "@/server/services/registrations";
import { createQrPayload } from "@/server/tickets/qr-token";

import { cancelRegistrationAction } from "./actions";

export const metadata: Metadata = { title: "My tickets" };

function qrImage(registrationId: string): Promise<string> {
  return QRCode.toDataURL(createQrPayload(registrationId), {
    width: 640,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

export default async function TicketsPage() {
  const actor = await requireActorOrRedirect();
  const { upcoming, past } = await listMyTickets(actor);

  const codes = new Map(
    await Promise.all(
      upcoming
        .filter((ticket) => ticket.status === "CONFIRMED")
        .map(async (ticket) => [ticket.id, await qrImage(ticket.id)] as const),
    ),
  );

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black">My tickets</h1>

      {upcoming.length + past.length === 0 && (
        <p className="mt-4 text-lg">
          Tickets you register for appear here.{" "}
          <Link href="/" className="font-bold underline underline-offset-4">
            See what&apos;s on
          </Link>
        </p>
      )}

      <ul className="mt-6 grid gap-8">
        {upcoming.map((ticket) => {
          const code = codes.get(ticket.id);
          return (
            <li key={ticket.id}>
              <Link
                href={`/e/${ticket.eventSlug}`}
                className="font-heading text-4xl leading-none font-black hover:underline"
              >
                {ticket.eventTitle}
              </Link>
              <p className="mt-2 text-lg">
                {formatEventTime(ticket.startsAt, ticket.endsAt)}
              </p>
              <p className="text-lg">{ticket.venue}</p>

              {ticket.eventStatus === "CANCELLED" ? (
                <p className="mt-3 text-lg font-bold">This event was cancelled.</p>
              ) : ticket.status === "PENDING_PAYMENT" ? (
                <p className="mt-3 text-lg font-bold">Waiting for your payment to confirm.</p>
              ) : ticket.status === "REFUNDED" ? (
                <p className="mt-3 text-lg font-bold">This ticket was refunded.</p>
              ) : ticket.checkedInAt ? (
                <p className="mt-3 text-lg font-bold">
                  Checked in {formatDateTime(ticket.checkedInAt)}
                </p>
              ) : (
                code && (
                  // A generated data URL, which next/image can't optimise.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={code}
                    alt={`QR ticket for ${ticket.eventTitle}`}
                    className="mt-4 aspect-square w-full rounded-xl bg-white"
                  />
                )
              )}

              {ticket.canCancel && (
                <ActionForm
                  action={cancelRegistrationAction}
                  confirmMessage={`Give up your seat at ${ticket.eventTitle}?`}
                  className="mt-3"
                >
                  <input type="hidden" name="registrationId" value={ticket.id} />
                  <Button type="submit" variant="ghost" className="h-11 px-3">
                    Cancel registration
                  </Button>
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>

      {past.length > 0 && (
        <section className="mt-12">
          <h2 className="font-heading text-4xl font-black">Past events</h2>
          <ul className="mt-3 divide-y">
            {past.map((ticket) => (
              <li key={ticket.id} className="py-3">
                <Link href={`/e/${ticket.eventSlug}`} className="font-bold hover:underline">
                  {ticket.eventTitle}
                </Link>
                <p className="text-muted-foreground">
                  {ticket.checkedInAt ? "Attended" : "Didn't check in"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

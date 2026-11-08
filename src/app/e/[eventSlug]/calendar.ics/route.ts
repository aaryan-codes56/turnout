import { env } from "@/lib/env";
import { buildIcs } from "@/lib/ics";
import { getPublicEventBySlug } from "@/server/services/events";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/e/[eventSlug]/calendar.ics">,
) {
  const { eventSlug } = await params;
  const row = await getPublicEventBySlug(eventSlug);
  if (!row) return new Response("Not found", { status: 404 });
  const { event } = row;

  const ics = buildIcs({
    id: event.id,
    title: event.title,
    description: event.descriptionMd,
    venue: event.venue,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    url: `${env.APP_URL}/e/${event.slug}`,
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${event.slug}.ics"`,
    },
  });
}

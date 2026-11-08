import { ImageResponse } from "next/og";

import { brand } from "@/lib/brand";
import { formatEventTime, formatPrice } from "@/lib/time";
import { getPublicEventBySlug } from "@/server/services/events";

export const alt = "Event details";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#21125e";
const STUB = "#ff9fc0";

export default async function OpenGraphImage({
  params,
}: PageProps<"/e/[eventSlug]">) {
  const { eventSlug } = await params;
  const row = await getPublicEventBySlug(eventSlug);
  const title = row?.event.title ?? brand.name;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundColor: STUB,
          color: INK,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 36, fontWeight: 700 }}>
          <span>{row?.clubName ?? brand.tagline}</span>
          <span>{brand.name}</span>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 40 ? 76 : 104,
            fontWeight: 800,
            lineHeight: 1.05,
          }}
        >
          {title}
        </div>
        {row ? (
          <div style={{ display: "flex", flexDirection: "column", fontSize: 38, fontWeight: 700 }}>
            <span>{formatEventTime(row.event.startsAt, row.event.endsAt)}</span>
            <span>
              {row.event.venue}, {formatPrice(row.event.pricePaise)}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}
      </div>
    ),
    size,
  );
}

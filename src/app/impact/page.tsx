import type { Metadata } from "next";
import Link from "next/link";

import { getImpactMetrics } from "@/server/services/metrics";

export const metadata: Metadata = { title: "Impact" };
export const dynamic = "force-dynamic";

const monthLabel = new Intl.DateTimeFormat("en-IN", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

/** Every month from the first to the last, so a quiet month shows as empty. */
function fillMonths(rows: readonly { month: string; events: number }[]) {
  if (rows.length === 0) return [];
  const counts = new Map(rows.map((row) => [row.month, row.events]));
  const [startYear, startMonth] = rows[0].month.split("-").map(Number);
  const [endYear, endMonth] = rows[rows.length - 1].month.split("-").map(Number);

  const months = [];
  for (
    let cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
    cursor <= new Date(Date.UTC(endYear, endMonth - 1, 1));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    const key = cursor.toISOString().slice(0, 7);
    months.push({ key, label: monthLabel.format(cursor), events: counts.get(key) ?? 0 });
  }
  return months;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="font-heading text-7xl leading-none font-black tabular-nums">
        {value.toLocaleString("en-IN")}
      </dd>
      <dt className="mt-1 text-lg">{label}</dt>
    </div>
  );
}

export default async function ImpactPage() {
  const { totals, perClub, perMonth } = await getImpactMetrics();
  const months = fillMonths(perMonth);
  const maxClub = Math.max(1, ...perClub.map((club) => club.checkins));
  const maxMonth = Math.max(1, ...months.map((month) => month.events));
  const peak = months.find((month) => month.events === maxMonth);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black sm:text-7xl">Impact</h1>
      <p className="mt-4 max-w-prose text-lg leading-relaxed">
        Live counts from Turnout&apos;s database. Demo data, test events and
        tickets paid with test-mode money are left out.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
        <Stat value={totals.activeClubs} label="Active clubs" />
        <Stat value={totals.events} label="Events held" />
        <Stat value={totals.checkins} label="Check-ins" />
        <Stat value={totals.uniqueAttendees} label="Unique attendees" />
      </dl>

      <section className="mt-12">
        <h2 className="font-heading text-4xl font-black">Check-ins per club</h2>
        {perClub.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No check-ins recorded yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {perClub.map((club) => (
              <li key={club.slug}>
                <div className="flex justify-between gap-3">
                  <Link href={`/c/${club.slug}`} className="font-bold hover:underline">
                    {club.name}
                  </Link>
                  <span className="tabular-nums">{club.checkins.toLocaleString("en-IN")}</span>
                </div>
                <div
                  className="mt-1 h-2.5 rounded-r bg-ring"
                  style={{ width: `${(club.checkins / maxClub) * 100}%` }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-heading text-4xl font-black">Events per month</h2>
        {months.length === 0 ? (
          <p className="mt-2 text-muted-foreground">No events have finished yet.</p>
        ) : (
          <>
            <div className="mt-6 flex h-48 items-end gap-[2px] border-b border-border">
              {months.map((month) => (
                <div
                  key={month.key}
                  tabIndex={0}
                  aria-label={`${month.label}: ${month.events} events`}
                  className="group relative flex h-full max-w-14 min-w-0 flex-1 items-end outline-none"
                >
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-sm whitespace-nowrap text-background group-hover:block group-focus:block">
                    {month.label}: {month.events}
                  </div>
                  <div
                    className="w-full rounded-t bg-ring group-hover:bg-foreground group-focus:bg-foreground"
                    style={{ height: `${(month.events / maxMonth) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-sm text-muted-foreground">
              <span>{months[0].label}</span>
              <span>
                {peak ? `Peak: ${peak.events} in ${peak.label}` : ""}
              </span>
              <span>{months[months.length - 1].label}</span>
            </div>
            <details className="mt-3">
              <summary className="inline-flex h-11 cursor-pointer items-center font-bold">
                View as table
              </summary>
              <table className="mt-1 w-full max-w-xs text-left">
                <thead>
                  <tr>
                    <th className="py-1">Month</th>
                    <th className="py-1 text-right">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((month) => (
                    <tr key={month.key}>
                      <td className="py-1">{month.label}</td>
                      <td className="py-1 text-right tabular-nums">{month.events}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>
    </main>
  );
}

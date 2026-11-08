import Link from "next/link";

import { AdmitStub } from "@/components/admit-stub";
import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { formatEventTime, formatPrice } from "@/lib/time";
import { getCurrentUser } from "@/server/auth/session";
import { listUpcomingEvents } from "@/server/services/events";

export default async function HomePage() {
  const [user, upcoming] = await Promise.all([
    getCurrentUser(),
    listUpcomingEvents(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-clip px-4 pt-6 pb-16 sm:px-6">
      <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-10">
      <section>
        <h1 className="font-heading text-[clamp(4rem,19vw,7.5rem)] leading-[0.88] font-black">
          {brand.tagline}
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed">
          {brand.description}
        </p>
        <div className="mt-8">
          {user ? (
            <p className="text-lg font-bold">
              You&apos;re signed in as {user.name}.
            </p>
          ) : (
            <Link
              href="/sign-in"
              className={cn(buttonVariants(), "h-12 px-6 text-base")}
            >
              Sign in with your college account
            </Link>
          )}
        </div>
      </section>
      <AdmitStub />
      </div>

      <section className="mt-16 max-w-3xl">
        <h2 className="font-heading text-5xl font-black">What&apos;s on</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-lg text-muted-foreground">
            No events are open right now. Check back soon.
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {upcoming.map((event) => (
              <li key={event.slug} className="py-4">
                <Link
                  href={`/e/${event.slug}`}
                  className="text-xl font-bold hover:underline"
                >
                  {event.title}
                </Link>
                <p className="text-muted-foreground">
                  {event.clubName}, {event.venue}
                </p>
                <p>
                  {formatEventTime(event.startsAt, event.endsAt)},{" "}
                  {formatPrice(event.pricePaise)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

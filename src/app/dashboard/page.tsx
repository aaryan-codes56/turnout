import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listClubsForActor } from "@/server/services/clubs";

export const metadata: Metadata = { title: "Your clubs" };

export default async function DashboardPage() {
  const actor = await requireActorOrRedirect();
  const { memberOf, pendingRequests } = await listClubsForActor(actor);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black">
        Your clubs
      </h1>

      {memberOf.length === 0 ? (
        <p className="mt-4 text-lg leading-relaxed">
          You aren&apos;t in a club yet. Request a new one, or ask a club owner
          to invite you.
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {memberOf.map((club) => (
            <li key={club.id}>
              <Link
                href={`/dashboard/${club.slug}`}
                className="flex min-h-14 items-center justify-between gap-4 py-3 hover:underline"
              >
                <span className="text-lg font-bold">{club.name}</span>
                <span className="text-muted-foreground capitalize">
                  {club.role.toLowerCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pendingRequests.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-4xl font-black">
            Waiting for approval
          </h2>
          <ul className="mt-3 divide-y">
            {pendingRequests.map((club) => (
              <li key={club.id} className="py-3 text-lg">
                {club.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href="/clubs/new"
        className={cn(buttonVariants(), "mt-8 h-12 px-6 text-base")}
      >
        Request a new club
      </Link>
    </main>
  );
}

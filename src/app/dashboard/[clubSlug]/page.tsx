import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClubBySlug } from "@/server/services/clubs";

export const metadata: Metadata = { title: "Club dashboard" };

const rowLink =
  "flex min-h-14 items-center py-3 text-lg font-bold hover:underline";

export default async function ClubDashboardPage({
  params,
}: PageProps<"/dashboard/[clubSlug]">) {
  const { clubSlug } = await params;
  const actor = await requireActorOrRedirect();
  const club = await getClubBySlug(clubSlug);
  if (!club || !can(actor, "club.viewDashboard", { clubId: club.id })) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black">
        {club.name}
      </h1>
      {club.status !== "ACTIVE" && (
        <p className="mt-3 text-lg">
          This club is {club.status.toLowerCase()}, so it isn&apos;t public.
        </p>
      )}
      <ul className="mt-6 divide-y">
        {club.status === "ACTIVE" && (
          <li>
            <Link href={`/c/${club.slug}`} className={rowLink}>
              View public page
            </Link>
          </li>
        )}
        {can(actor, "member.view", { clubId: club.id }) && (
          <li>
            <Link href={`/dashboard/${club.slug}/members`} className={rowLink}>
              Members and roles
            </Link>
          </li>
        )}
      </ul>
    </main>
  );
}

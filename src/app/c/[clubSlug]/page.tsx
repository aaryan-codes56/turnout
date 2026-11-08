import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClubLogo } from "@/components/club-logo";
import { getPublicClubBySlug } from "@/server/services/clubs";

export async function generateMetadata({
  params,
}: PageProps<"/c/[clubSlug]">): Promise<Metadata> {
  const { clubSlug } = await params;
  const club = await getPublicClubBySlug(clubSlug);
  return club
    ? { title: club.name, description: club.description.slice(0, 160) }
    : {};
}

export default async function ClubPage({
  params,
}: PageProps<"/c/[clubSlug]">) {
  const { clubSlug } = await params;
  const club = await getPublicClubBySlug(clubSlug);
  if (!club) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <ClubLogo name={club.name} logoUrl={club.logoUrl} />
      <h1 className="mt-5 font-heading text-6xl leading-none font-black sm:text-7xl">
        {club.name}
      </h1>
      <p className="mt-5 max-w-prose text-lg leading-relaxed whitespace-pre-line">
        {club.description}
      </p>
      <h2 className="mt-12 font-heading text-4xl font-black">Events</h2>
      <p className="mt-2 text-muted-foreground">
        This club hasn&apos;t published any events yet.
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listClubsForAdmin } from "@/server/services/clubs";

import { approveClubAction, archiveClubAction } from "./actions";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminClubsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "club.approve")) notFound();

  const allClubs = await listClubsForAdmin(actor);
  const pending = allClubs.filter((club) => club.status === "PENDING");
  const others = allClubs.filter((club) => club.status !== "PENDING");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <AdminNav />
      <h1 className="mt-2 font-heading text-6xl leading-none font-black">
        Clubs
      </h1>

      <h2 className="mt-8 font-heading text-4xl font-black">
        Waiting for approval
      </h2>
      {pending.length === 0 ? (
        <p className="mt-2 text-muted-foreground">No requests to review.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {pending.map((club) => (
            <li key={club.id} className="py-4">
              <p className="text-lg font-bold">{club.name}</p>
              <p className="wrap-anywhere text-muted-foreground">
                {club.requesterEmail}
              </p>
              <p className="text-muted-foreground">
                Requested {formatDateTime(club.createdAt)}
              </p>
              <p className="mt-2 max-w-prose whitespace-pre-line">
                {club.description}
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-2">
                <ActionForm action={approveClubAction}>
                  <input type="hidden" name="clubId" value={club.id} />
                  <Button type="submit" className="h-11 px-5">
                    Approve
                  </Button>
                </ActionForm>
                <ActionForm
                  action={archiveClubAction}
                  confirmMessage={`Decline the request for ${club.name}?`}
                >
                  <input type="hidden" name="clubId" value={club.id} />
                  <Button type="submit" variant="ghost" className="h-11 px-5">
                    Decline
                  </Button>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 font-heading text-4xl font-black">All clubs</h2>
      {others.length === 0 ? (
        <p className="mt-2 text-muted-foreground">No approved clubs yet.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {others.map((club) => (
            <li
              key={club.id}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-bold">{club.name}</p>
                <p className="text-muted-foreground capitalize">
                  {club.status.toLowerCase()}
                </p>
              </div>
              {club.status === "ACTIVE" && (
                <ActionForm
                  action={archiveClubAction}
                  confirmMessage={`Archive ${club.name}? It disappears from public pages.`}
                >
                  <input type="hidden" name="clubId" value={club.id} />
                  <Button type="submit" variant="ghost" className="h-11 px-4">
                    Archive
                  </Button>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

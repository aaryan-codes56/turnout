import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime } from "@/lib/time";
import { pageSchema } from "@/lib/validation";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { AUDIT_PAGE_SIZE, listAuditLogs } from "@/server/services/admin";

import { AdminNav } from "../admin-nav";

export const metadata: Metadata = { title: "Audit log" };

const pagerLink =
  "inline-flex h-11 items-center font-bold underline-offset-4 hover:underline";

export default async function AuditLogPage({
  searchParams,
}: PageProps<"/admin/audit">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "audit.view")) notFound();

  const page = pageSchema.parse((await searchParams).page);
  const { entries, total } = await listAuditLogs(actor, page);
  const hasNewer = page > 1;
  const hasOlder = page * AUDIT_PAGE_SIZE < total;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <AdminNav />
      <h1 className="mt-2 font-heading text-6xl leading-none font-black">
        Audit log
      </h1>

      {entries.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-6 divide-y">
          {entries.map((entry) => (
            <li key={entry.id} className="py-3">
              <p className="font-bold">{entry.action}</p>
              <p className="wrap-anywhere text-muted-foreground">
                {entry.actorEmail ?? "Command line"}
              </p>
              <p className="text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </p>
              <p className="mt-1 text-sm wrap-anywhere">
                {JSON.stringify(entry.metadata)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex gap-5">
        {hasNewer && (
          <Link href={`/admin/audit?page=${page - 1}`} className={pagerLink}>
            Newer
          </Link>
        )}
        {hasOlder && (
          <Link href={`/admin/audit?page=${page + 1}`} className={pagerLink}>
            Older
          </Link>
        )}
      </div>
    </main>
  );
}

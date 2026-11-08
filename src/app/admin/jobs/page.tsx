import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/time";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listFailedJobs } from "@/server/services/admin";

import { retryJobAction } from "../actions";
import { AdminNav } from "../admin-nav";

export const metadata: Metadata = { title: "Failed jobs" };

export default async function FailedJobsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "platform.viewFailedJobs")) notFound();

  const jobs = await listFailedJobs(actor);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <AdminNav />
      <h1 className="mt-2 font-heading text-6xl leading-none font-black">Failed jobs</h1>

      {jobs.length === 0 ? (
        <p className="mt-4 text-muted-foreground">No failed jobs.</p>
      ) : (
        <ul className="mt-6 divide-y">
          {jobs.map((job) => (
            <li key={job.id} className="py-4">
              <p className="font-bold">{job.name}</p>
              <p className="text-muted-foreground">
                {job.completed_on ? formatDateTime(new Date(job.completed_on)) : "Time unknown"},{" "}
                {job.retry_count} {job.retry_count === 1 ? "retry" : "retries"}
              </p>
              <p className="mt-1 text-sm wrap-anywhere">{JSON.stringify(job.data)}</p>
              <p className="mt-1 text-sm wrap-anywhere text-destructive">
                {JSON.stringify(job.output)}
              </p>
              <ActionForm action={retryJobAction} className="mt-2">
                <input type="hidden" name="name" value={job.name} />
                <input type="hidden" name="id" value={job.id} />
                <Button type="submit" variant="outline" className="h-11 px-4">
                  Retry
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

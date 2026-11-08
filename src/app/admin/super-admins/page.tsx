import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listSuperAdmins } from "@/server/services/admin";

import { setPlatformRoleAction } from "../actions";
import { AdminNav } from "../admin-nav";

export const metadata: Metadata = { title: "Super admins" };

export default async function SuperAdminsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "platform.manageAdmins")) notFound();

  const admins = await listSuperAdmins(actor);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <AdminNav />
      <h1 className="mt-2 font-heading text-6xl leading-none font-black">
        Super admins
      </h1>
      <ul className="mt-6 divide-y">
        {admins.map((admin) => (
          <li
            key={admin.id}
            className="flex items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="font-bold">{admin.name}</p>
              <p className="wrap-anywhere text-muted-foreground">
                {admin.email}
              </p>
            </div>
            <ActionForm
              action={setPlatformRoleAction}
              confirmMessage={`Remove super admin access from ${admin.email}?`}
            >
              <input type="hidden" name="email" value={admin.email} />
              <input type="hidden" name="role" value="USER" />
              <Button type="submit" variant="ghost" className="h-11 px-4">
                Demote
              </Button>
            </ActionForm>
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="font-heading text-4xl font-black">Add a super admin</h2>
        <p className="mt-2">They need to have signed in to Turnout once.</p>
        <ActionForm action={setPlatformRoleAction} className="mt-4 grid gap-4">
          <input type="hidden" name="role" value="SUPER_ADMIN" />
          <div className="grid gap-2">
            <Label htmlFor="email">College email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              className="h-11"
            />
          </div>
          <Button type="submit" className="h-12 text-base">
            Promote
          </Button>
        </ActionForm>
      </section>
    </main>
  );
}

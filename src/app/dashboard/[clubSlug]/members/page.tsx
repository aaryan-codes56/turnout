import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { can, CLUB_ROLES } from "@/server/auth/permissions";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClubBySlug } from "@/server/services/clubs";
import { listMembers } from "@/server/services/members";

import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from "./actions";

export const metadata: Metadata = { title: "Members and roles" };

const ROLE_LABELS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  VOLUNTEER: "Volunteer",
} as const;

function RoleOptions() {
  return CLUB_ROLES.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ));
}

export default async function MembersPage({
  params,
}: PageProps<"/dashboard/[clubSlug]/members">) {
  const { clubSlug } = await params;
  const actor = await requireActorOrRedirect();
  const club = await getClubBySlug(clubSlug);
  if (!club || !can(actor, "member.view", { clubId: club.id })) notFound();

  const { members, pendingInvites } = await listMembers(actor, club.id);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16 sm:px-6">
      <Link
        href={`/dashboard/${club.slug}`}
        className="inline-flex h-11 items-center font-bold underline-offset-4 hover:underline"
      >
        {club.name}
      </Link>
      <h1 className="font-heading text-6xl leading-none font-black">Members</h1>

      <ul className="mt-6 divide-y">
        {members.map((member) => (
          <li key={member.userId} className="py-4">
            <p className="font-bold">{member.name}</p>
            <p className="wrap-anywhere text-muted-foreground">
              {member.email}
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              <ActionForm
                key={member.role}
                action={changeMemberRoleAction}
                className="flex gap-2"
              >
                <input type="hidden" name="clubId" value={club.id} />
                <input type="hidden" name="userId" value={member.userId} />
                <NativeSelect
                  name="role"
                  defaultValue={member.role}
                  aria-label={`Role for ${member.name}`}
                >
                  <RoleOptions />
                </NativeSelect>
                <Button type="submit" variant="outline" className="h-11 px-4">
                  Save role
                </Button>
              </ActionForm>
              <ActionForm
                action={removeMemberAction}
                confirmMessage={`Remove ${member.name} from ${club.name}?`}
              >
                <input type="hidden" name="clubId" value={club.id} />
                <input type="hidden" name="userId" value={member.userId} />
                <Button type="submit" variant="ghost" className="h-11 px-4">
                  Remove
                </Button>
              </ActionForm>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-10">
        <h2 className="font-heading text-4xl font-black">Invite someone</h2>
        <ActionForm action={inviteMemberAction} className="mt-4 grid gap-4">
          <input type="hidden" name="clubId" value={club.id} />
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
          <div className="grid gap-2">
            <Label htmlFor="role">Role</Label>
            <NativeSelect id="role" name="role" defaultValue="VOLUNTEER">
              <RoleOptions />
            </NativeSelect>
          </div>
          <Button type="submit" className="h-12 text-base">
            Send invite
          </Button>
        </ActionForm>
      </section>

      {pendingInvites.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-4xl font-black">Pending invites</h2>
          <ul className="mt-3 divide-y">
            {pendingInvites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-x-3 py-3"
              >
                <div className="min-w-0">
                  <p className="font-bold wrap-anywhere">{invite.email}</p>
                  <p className="text-muted-foreground">
                    {ROLE_LABELS[invite.role]}
                  </p>
                </div>
                <ActionForm action={revokeInviteAction}>
                  <input type="hidden" name="clubId" value={club.id} />
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <Button type="submit" variant="ghost" className="h-11 px-4">
                    Cancel invite
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

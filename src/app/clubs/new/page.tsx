import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireActorOrRedirect } from "@/server/auth/session";

import { requestClubAction } from "./actions";

export const metadata: Metadata = { title: "Request a club" };

export default async function RequestClubPage() {
  await requireActorOrRedirect();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-8 pb-16 sm:px-6">
      <h1 className="font-heading text-6xl leading-none font-black">
        Request a club
      </h1>
      <p className="mt-4 text-lg leading-relaxed">
        A Turnout admin reviews each request. Once it&apos;s approved, you
        become the club&apos;s owner.
      </p>
      <ActionForm action={requestClubAction} className="mt-8 grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="name">Club name</Label>
          <Input
            id="name"
            name="name"
            required
            minLength={3}
            maxLength={80}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">What does the club do?</Label>
          <Textarea
            id="description"
            name="description"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="logoUrl">Logo link (optional)</Label>
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            placeholder="https://"
            className="h-11"
          />
        </div>
        <Button type="submit" className="h-12 text-base">
          Send request
        </Button>
      </ActionForm>
    </main>
  );
}
